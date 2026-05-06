// Registrar Service Worker para PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registrado con éxito', reg.scope))
            .catch(err => console.log('Error al registrar Service Worker', err));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('download-form');
    const urlInput = document.getElementById('video-url');
    const submitBtn = document.getElementById('submit-btn');
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    const resultSection = document.getElementById('result-section');
    
    // Result elements
    const resThumb = document.getElementById('res-thumb');
    const resPlatform = document.getElementById('res-platform');
    const resTitle = document.getElementById('res-title');
    const resDuration = document.getElementById('res-duration');
    const resFormats = document.getElementById('res-formats');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const url = urlInput.value.trim();
        if (!url) return;

        // Reset UI state
        errorEl.classList.add('hidden');
        resultSection.classList.add('hidden');
        loadingEl.classList.remove('hidden');
        submitBtn.disabled = true;

        try {
            const response = await fetch('/api/info', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error al procesar el enlace');
            }

            // Populate UI with data
            resTitle.textContent = data.title;
            resThumb.src = data.thumbnail;
            resDuration.textContent = data.duration || 'Desconocida';
            
            // Set platform icon
            let iconClass = 'fa-solid fa-video';
            let iconColor = '#fff';
            if (data.platform.includes('youtube')) {
                iconClass = 'fa-brands fa-youtube';
                iconColor = '#ff0000';
            } else if (data.platform.includes('facebook')) {
                iconClass = 'fa-brands fa-facebook';
                iconColor = '#1877f2';
            } else if (data.platform.includes('tiktok')) {
                iconClass = 'fa-brands fa-tiktok';
                iconColor = '#00f2fe';
            }
            resPlatform.innerHTML = `<i class="${iconClass}" style="color: ${iconColor};"></i>`;

            // Render formats
            resFormats.innerHTML = '';
            
            // Filter unique resolutions
            const uniqueResolutions = new Set();
            const filteredFormats = [];
            
            data.formats.forEach(f => {
                if (f.resolution === 'Audio') {
                    filteredFormats.push(f);
                } else if (f.resolution !== 'unknown' && f.resolution.includes('x') && !uniqueResolutions.has(f.resolution)) {
                    uniqueResolutions.add(f.resolution);
                    filteredFormats.push(f);
                }
            });

            const finalFormats = filteredFormats.length > 0 ? filteredFormats.slice(0, 5) : data.formats.slice(0, 4);

            if (finalFormats.length === 0) {
                 resFormats.innerHTML = '<p style="color: var(--text-muted)">No se encontraron formatos directos disponibles.</p>';
            }

            finalFormats.forEach(format => {
                const height = format.resolution === 'Audio' ? '🎵 Audio MP3' : (format.resolution !== 'unknown' ? format.resolution.split('x')[1] + 'p' : format.ext.toUpperCase());
                const size = format.filesize ? formatBytes(format.filesize) : 'Tamaño desc.';
                
                // Generar el enlace hacia nuestro propio servidor para forzar la descarga
                let downloadUrl = `/api/download?url=${encodeURIComponent(url)}&format_id=${format.format_id}&ext=${format.ext}&title=${encodeURIComponent(data.title)}`;

                // Si usamos una API de respaldo, descargamos directamente del enlace seguro
                if (format.direct_url) {
                    downloadUrl = format.direct_url;
                }

                const btnHtml = `
                    <a href="${downloadUrl}" class="dl-btn" download onclick="window.showDownloadToast('${height}')">
                        <div class="dl-info">
                            <span class="dl-res">${height}</span>
                            <span class="dl-size"><i class="fa-solid fa-hard-drive"></i> ${size}</span>
                        </div>
                        <div class="dl-action">
                            <i class="fa-solid fa-download"></i> Descargar
                        </div>
                    </a>
                `;
                resFormats.insertAdjacentHTML('beforeend', btnHtml);
            });

            // Show results
            loadingEl.classList.add('hidden');
            resultSection.classList.remove('hidden');

        } catch (error) {
            loadingEl.classList.add('hidden');
            errorText.textContent = error.message;
            errorEl.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
        }
    });

    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    // Función global para mostrar el toast desde los botones
    window.showDownloadToast = function(quality) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = 'toast';
        
        toast.innerHTML = `
            <i class="fa-solid fa-circle-down fa-bounce"></i>
            <div class="toast-content">
                <span class="toast-title">Descarga Iniciada</span>
                <span class="toast-message">Preparando video en ${quality}...</span>
            </div>
        `;
        
        container.appendChild(toast);
        
        // Eliminar el toast después de la animación
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => {
                if(container.contains(toast)) {
                    container.removeChild(toast);
                }
            }, 500);
        }, 4000);
    };
});
