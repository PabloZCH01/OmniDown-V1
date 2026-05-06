const express = require('express');
const cors = require('cors');
const ytDlp = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Endpoint para obtener información del video
app.post('/api/info', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'La URL es requerida' });

    // Corrección automática si el usuario pega enlaces de ssyoutube
    url = url.replace('ssyoutube.com', 'youtube.com');

    try {
        const execFile = require('util').promisify(require('child_process').execFile);
        const isWindows = process.platform === 'win32';
        const ytDlpPath = path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', isWindows ? 'yt-dlp.exe' : 'yt-dlp');
        
        console.log(`Obteniendo info para: ${url}`);
        
        let stdoutData;
        try {
            const result = await execFile(ytDlpPath, [
                url,
                '--dump-json',
                '--no-playlist',
                '--no-warnings',
                '--prefer-free-formats',
                '--force-ipv4',
                '--extractor-args', 'youtube:player_client=android'
            ]);
            stdoutData = result.stdout;
        } catch (execError) {
            // execFile might reject if there's stderr output (like warnings) even if it succeeds
            if (execError.stdout) {
                stdoutData = execError.stdout;
            } else {
                const stderrMsg = execError.stderr ? execError.stderr.toString() : '';
                throw new Error(`${execError.message} \n\nDetalle yt-dlp: ${stderrMsg}`);
            }
        }

        // EXTRAER FORMATOS
        let formats = [];
        try {
            const jsonLine = stdoutData.split('\n').find(line => line.trim().startsWith('{'));
            if (!jsonLine) throw new Error('No se encontró JSON en yt-dlp');
            
            const info = JSON.parse(jsonLine);
            formats = info.formats
                .filter(f => f.ext === 'mp4' && f.vcodec !== 'none' && f.acodec !== 'none' && f.format_id)
                .map(f => ({
                    format_id: f.format_id,
                    resolution: f.resolution || 'Auto',
                    ext: f.ext,
                    url: f.url,
                    filesize: f.filesize
                }))
                .sort((a, b) => (b.filesize || 0) - (a.filesize || 0));

            if (formats.length === 0) {
                formats.push({ format_id: 'best', resolution: 'Video (Mejor Calidad)', ext: 'mp4', filesize: null });
            }
            formats.unshift({ format_id: 'bestaudio', resolution: 'Audio', ext: 'mp3', filesize: null });

            const uniqueResolutions = new Set();
            formats = formats.filter(f => {
                if (f.format_id === 'bestaudio' || f.format_id === 'best') return true;
                if (uniqueResolutions.has(f.resolution)) return false;
                uniqueResolutions.add(f.resolution);
                return true;
            });

            return res.json({
                title: info.title,
                thumbnail: info.thumbnail,
                duration: info.duration_string || 'N/A',
                platform: info.extractor_key,
                formats: formats
            });

        } catch (parseError) {
            throw new Error(`Parse failed: ${parseError.message}`);
        }

    } catch (error) {
        console.error('yt-dlp falló, intentando RESPALDO INVIDIOUS:', error.message);
        
        // RESPALDO INVIDIOUS (API PÚBLICA ANTIBLOQUEO)
        try {
            if (!url.includes('youtube') && !url.includes('youtu.be')) throw new Error('No es youtube');
            const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([^&]+)/);
            if (!videoIdMatch) throw new Error('ID no encontrado');
            
            const fetch = require('util').promisify(require('https').get);
            
            // Función helper para consumir API HTTP
            const fetchJson = (url) => new Promise((resolve, reject) => {
                require('https').get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
                    let data = '';
                    resp.on('data', chunk => data += chunk);
                    resp.on('end', () => {
                        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
                    });
                }).on('error', reject);
            });

            const invidiousData = await fetchJson(`https://invidious.asir.dev/api/v1/videos/${videoIdMatch[1]}`);
            
            const fallbackFormats = [];
            
            // Buscar video con audio (mp4)
            const videoStreams = invidiousData.formatStreams || [];
            if (videoStreams.length > 0) {
                fallbackFormats.push({
                    format_id: 'inv_video',
                    resolution: videoStreams[0].resolution || 'Video',
                    ext: 'mp4',
                    direct_url: videoStreams[0].url, // URL DIRECTO DESDE INVIDIOUS
                    filesize: null
                });
            }

            // Buscar audio
            const audioStreams = invidiousData.adaptiveFormats?.filter(f => f.type && f.type.includes('audio')) || [];
            if (audioStreams.length > 0) {
                fallbackFormats.unshift({
                    format_id: 'inv_audio',
                    resolution: 'Audio',
                    ext: 'mp3',
                    direct_url: audioStreams[0].url, // URL DIRECTO DESDE INVIDIOUS
                    filesize: null
                });
            }

            if (fallbackFormats.length === 0) throw new Error("No hay streams en Invidious");

            return res.json({
                title: invidiousData.title,
                thumbnail: invidiousData.videoThumbnails ? invidiousData.videoThumbnails[0].url : '',
                duration: invidiousData.lengthSeconds ? `${Math.floor(invidiousData.lengthSeconds/60)}:${invidiousData.lengthSeconds%60}` : 'N/A',
                platform: 'youtube',
                formats: fallbackFormats
            });

        } catch (invidiousError) {
            console.error('Invidious fallback falló:', invidiousError.message);
            res.status(500).json({ error: 'Error del servidor. YouTube está bloqueando la descarga. Detalle: ' + (error.message || 'Desconocido').substring(0, 200) });
        }
    }
});

// Endpoint para descargar el video y enviarlo al navegador
app.get('/api/download', (req, res) => {
    let { url, format_id, title, ext } = req.query;
    if (!url) return res.status(400).send('La URL es requerida');

    // Corrección automática si el usuario pega enlaces de ssyoutube
    url = url.replace('ssyoutube.com', 'youtube.com');

    const spawn = require('child_process').spawn;
    const isWindows = process.platform === 'win32';
    const ytDlpPath = path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', isWindows ? 'yt-dlp.exe' : 'yt-dlp');
    
    const safeTitle = (title || 'video').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    const filename = `${safeTitle}.${ext || 'mp4'}`;
    
    // Cabeceras para forzar la descarga en el navegador
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Type', 'application/octet-stream');

    console.log(`Iniciando descarga: ${filename} (Formato: ${format_id})`);

    const ytDlpProcess = spawn(ytDlpPath, [
        url,
        '-f', format_id || 'best',
        '-o', '-', // Output to stdout
        '--no-playlist',
        '--no-warnings',
        '--force-ipv4',
        '--extractor-args', 'youtube:player_client=android'
    ]);

    // Enviar los datos del video al cliente conforme se descargan
    ytDlpProcess.stdout.pipe(res);

    ytDlpProcess.stderr.on('data', (data) => {
        // console.error(`[yt-dlp]: ${data}`);
    });

    ytDlpProcess.on('close', (code) => {
        console.log(`Descarga finalizada con código ${code}`);
    });
    
    req.on('close', () => {
        if (!ytDlpProcess.killed) {
            console.log('El usuario canceló la descarga');
            ytDlpProcess.kill();
        }
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
