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
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'La URL es requerida' });

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

        // Extraer solo la primera línea que parezca un JSON válido en caso de que haya texto basura
        const jsonLine = stdoutData.split('\n').find(line => line.trim().startsWith('{'));
        if (!jsonLine) {
            throw new Error('No se pudo encontrar información de video válida en la respuesta');
        }

        const info = JSON.parse(jsonLine);
        let formats = info.formats
            .filter(f => f.ext === 'mp4' && f.vcodec !== 'none' && f.acodec !== 'none' && f.format_id)
            .map(f => ({
                format_id: f.format_id,
                resolution: f.resolution || 'Auto',
                ext: f.ext,
                url: f.url,
                filesize: f.filesize
            }))
            .sort((a, b) => (b.filesize || 0) - (a.filesize || 0));

        // Si la plataforma (como Facebook) no nos da formatos con audio+video juntos, creamos una opción segura "best"
        if (formats.length === 0) {
            formats.push({
                format_id: 'best',
                resolution: 'Video (Mejor Calidad)',
                ext: 'mp4',
                filesize: null
            });
        }

        // Siempre inyectar una opción de "Solo Audio" garantizada para TikTok y todas las demás
        formats.unshift({
            format_id: 'bestaudio',
            resolution: 'Audio',
            ext: 'mp3',
            filesize: null
        });

        // Limpiar duplicados de resolución (opcional, para una lista más limpia)
        const uniqueResolutions = new Set();
        formats = formats.filter(f => {
            if (f.format_id === 'bestaudio' || f.format_id === 'best') return true;
            if (uniqueResolutions.has(f.resolution)) return false;
            uniqueResolutions.add(f.resolution);
            return true;
        });

        res.json({
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration_string || 'N/A',
            platform: info.extractor_key,
            formats: formats
        });
    } catch (error) {
        console.error('Error al procesar el video:', error);
        res.status(500).json({ error: 'Error del servidor: ' + (error.message || 'Error desconocido').substring(0, 200) });
    }
});

// Endpoint para descargar el video y enviarlo al navegador
app.get('/api/download', (req, res) => {
    const { url, format_id, ext, title } = req.query;
    if (!url) return res.status(400).send('La URL es requerida');

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
