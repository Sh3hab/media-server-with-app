
const idb = {
    db: null,
    async init() {
        if (this.db) return;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('PremiumMediaOffline', 1);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('videos')) {
                    db.createObjectStore('videos');
                }
                if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata');
                }
            };
            req.onsuccess = e => {
                this.db = e.target.result;
                resolve();
            };
            req.onerror = e => reject(e);
        });
    },
    async set(storeName, key, value) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = e => reject(e);
        });
    },
    async get(storeName, key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = e => resolve(e.target.result);
            req.onerror = e => reject(e);
        });
    },
    async remove(storeName, key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = e => reject(e);
        });
    },
    async getAll(storeName) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = e => resolve(e.target.result);
            req.onerror = e => reject(e);
        });
    },
    async clear(storeName) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = e => reject(e);
        });
    }
};
window.idb = idb;

window.DownloadManager = {
    activeDownloads: {},
    downloadedIds: new Set(),
    
    async init() {
        await idb.init();
        await this.cleanupExpired();
        await this.refreshDownloadedIds();
    },

    async deleteAll() {
        if (!confirm('هل أنت متأكد من رغبتك في حذف جميع المحتويات المحملة بلا استثناء؟')) return;
        try {
            await idb.clear('videos');
            await idb.clear('metadata');
            this.activeDownloads = {};
            await this.refreshDownloadedIds();
            alert('تم حذف جميع التنزيلات بنجاح.');
            if (window.Views && window.Views.renderDownloadsScreen) {
                window.Views.renderDownloadsScreen();
            }
        } catch (err) {
            alert('فشل في حذف التنزيلات: ' + err.message);
        }
    },

    async refreshDownloadedIds() {
        this.downloadedIds.clear();
        try {
            const items = await idb.getAll('metadata');
            for (const item of items) {
                if (item && !item.isExpired) {
                    this.downloadedIds.add(String(item.id));
                }
            }
        } catch (e) {
            console.error('Failed to refresh downloaded IDs:', e);
        }
    },

    async cleanupExpired() {
        const items = await idb.getAll('metadata');
        const now = Date.now();
        for (const item of items) {
            if (item.expiresAt && now > item.expiresAt && !item.isExpired) {
                // Delete the large video blob to save space, mark as expired
                await idb.remove('videos', item.id);
                item.isExpired = true;
                await idb.set('metadata', item.id, item);
            }
        }
    },

    async canDownload(type) {
        const items = await idb.getAll('metadata');
        let movieCount = 0;
        let episodeCount = 0;
        
        items.forEach(item => {
            if (!item.isExpired) {
                if (item.type === 'movie') movieCount++;
                if (item.type === 'episode') episodeCount++;
            }
        });

        if (type === 'movie' && movieCount >= 4) return false;
        if (type === 'episode' && episodeCount >= 10) return false;
        return true;
    },

    async startDownload(id, url, metadata) {
        if (typeof currentSession !== 'undefined' && currentSession && currentSession.download_expiry_days === 'prevent') {
            alert('عذراً، ميزة التنزيل غير مفعلة لحسابك.');
            return;
        }

        if (!await this.canDownload(metadata.type)) {
            alert('لقد وصلت للحد الأقصى للتنزيلات (4 أفلام، 10 حلقات). يرجى حذف بعضها أولاً.');
            return;
        }

        if (this.activeDownloads[id]) return;

        // 1. Download and convert poster to Base64
        if (metadata.poster && !metadata.poster.startsWith('data:')) {
            try {
                let posterUrl = metadata.poster;
                if (!posterUrl.startsWith('http') && !posterUrl.startsWith('//')) {
                    posterUrl = window.location.origin + (posterUrl.startsWith('/') ? '' : '/') + posterUrl;
                }
                const imgRes = await fetch(posterUrl);
                if (imgRes.ok) {
                    const imgBlob = await imgRes.blob();
                    const base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(imgBlob);
                    });
                    metadata.poster = base64;
                }
            } catch (imgErr) {
                console.error('Failed to cache image for offline:', imgErr);
            }
        }

        // Cache seriesPoster if available
        if (metadata.seriesPoster && !metadata.seriesPoster.startsWith('data:')) {
            try {
                let seriesPosterUrl = metadata.seriesPoster;
                if (!seriesPosterUrl.startsWith('http') && !seriesPosterUrl.startsWith('//')) {
                    seriesPosterUrl = window.location.origin + (seriesPosterUrl.startsWith('/') ? '' : '/') + seriesPosterUrl;
                }
                const imgRes = await fetch(seriesPosterUrl);
                if (imgRes.ok) {
                    const imgBlob = await imgRes.blob();
                    const base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(imgBlob);
                    });
                    metadata.seriesPoster = base64;
                }
            } catch (imgErr) {
                console.error('Failed to cache series poster for offline:', imgErr);
            }
        }

        // 2. Download and cache subtitle content if available
        if (metadata.subtitleUrl && metadata.subtitleUrl !== 'null' && metadata.subtitleUrl !== 'undefined') {
            try {
                let subUrl = metadata.subtitleUrl;
                if (!subUrl.startsWith('http') && !subUrl.startsWith('//')) {
                    subUrl = window.location.origin + (subUrl.startsWith('/') ? '' : '/') + subUrl;
                }
                const subRes = await fetch(subUrl);
                if (subRes.ok) {
                    metadata.subtitleContent = await subRes.text();
                    console.log('Successfully cached subtitles for offline use!');
                }
            } catch (subErr) {
                console.error('Failed to cache subtitle for offline:', subErr);
            }
        }

        try {
            this.activeDownloads[id] = { progress: 0, speed: 0, metadata: metadata };
            this.updateUI();

            const response = await fetch(url);
            if (!response.ok) throw new Error('فشل تنزيل الملف');

            const totalSize = parseInt(response.headers.get('content-length'), 10) || 0;
            let loaded = 0;
            let startTime = Date.now();
            let lastUpdate = Date.now();
            let loadedSinceLast = 0;

            const reader = response.body.getReader();
            const chunks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                loaded += value.length;
                loadedSinceLast += value.length;

                const now = Date.now();
                if (now - lastUpdate > 500) {
                    const progress = totalSize ? Math.round((loaded / totalSize) * 100) : 0;
                    const speed = (loadedSinceLast / (now - lastUpdate)) * 1000; // bytes per sec
                    this.activeDownloads[id] = { progress, speed, metadata };
                    this.updateUI();
                    
                    lastUpdate = now;
                    loadedSinceLast = 0;
                }
            }

            const blob = new Blob(chunks, { type: 'video/mp4' });
            
            if (blob.size < 1000) {
                throw new Error(`الملف فارغ أو صغير جداً (${blob.size} بايت) - قد يكون رابط الفيديو غير صالح.`);
            }
            const headerText = await blob.slice(0, 200).text();
            if (headerText.trim().toLowerCase().startsWith('<!doctype html') || headerText.includes('<html') || headerText.includes('<head')) {
                throw new Error(`رابط الفيديو غير صالح - السيرفر يعيد صفحة HTML بدلاً من ملف الفيديو. حجم الملف: ${(blob.size/1024).toFixed(1)} KB`);
            }

            await idb.set('videos', id, blob);

            // Calculate expiration
            let expiryMs = 2 * 24 * 60 * 60 * 1000; // default 2 days
            const expiryVal = (typeof currentSession !== 'undefined' && currentSession) ? (currentSession.download_expiry_days) : '2d';
            
            if (expiryVal === 'prevent') {
                throw new Error('عذراً، ميزة التنزيل غير مفعلة لحسابك.');
            }
            
            const num = parseFloat(expiryVal);
            if (!isNaN(num)) {
                const expiryStr = String(expiryVal);
                if (expiryStr.endsWith('h')) {
                    expiryMs = num * 60 * 60 * 1000;
                } else if (expiryStr.endsWith('d')) {
                    expiryMs = num * 24 * 60 * 60 * 1000;
                } else {
                    // Backward compatibility: raw numbers are days
                    expiryMs = num * 24 * 60 * 60 * 1000;
                }
            }
            metadata.expiresAt = Date.now() + expiryMs;
            metadata.id = id;
            metadata.isExpired = false;
            metadata.downloadedAt = Date.now();
            
            await idb.set('metadata', id, metadata);

            // Add to downloadedIds cache
            this.downloadedIds.add(String(id));

            // Visual Checkmark Animation for Details View download button
            const icon = document.getElementById(`dl-icon-${id}`) || document.querySelector(`#det-download-${id} i`);
            if (icon) {
                icon.className = 'fa-solid fa-check text-primary transition-all duration-500 scale-0';
                setTimeout(() => {
                    icon.classList.remove('scale-0');
                    icon.classList.add('scale-125', 'bounce-animation');
                }, 50);
            }
            const btn = document.getElementById(`det-download-${id}`);
            if (btn) {
                btn.className = "w-16 h-16 rounded-2xl bg-primary/20 text-primary border-primary/20 backdrop-blur-xl flex flex-col items-center justify-center transition-all group active:scale-90 overflow-hidden relative";
                btn.onclick = () => {}; // Disable click action since it's already downloaded
            }

            // Visual Checkmark Animation for Episode Card download button
            const epIcon = document.getElementById(`ep-dl-icon-${id}`);
            if (epIcon) {
                epIcon.className = 'fa-solid fa-check text-[10px] transition-all duration-500 scale-0';
                setTimeout(() => {
                    epIcon.classList.remove('scale-0');
                    epIcon.classList.add('scale-110');
                }, 50);
            }
            const epBtn = document.getElementById(`ep-dl-btn-${id}`);
            if (epBtn) {
                epBtn.className = "w-7 h-7 rounded-full bg-primary text-black flex items-center justify-center transition-all relative overflow-hidden group/dl";
                epBtn.onclick = (e) => e.stopPropagation(); // Disable click action
            }
            
            delete this.activeDownloads[id];
            this.updateUI();
            
        } catch (error) {
            console.error('Download failed:', error);
            delete this.activeDownloads[id];
            this.updateUI();
            alert('فشل تنزيل ' + metadata.title + ':\n' + error.message);
        }
    },

    async getDownloadedVideoUrl(id) {
        const metadata = await idb.get('metadata', id);
        if (metadata && !metadata.isExpired) {
            const blob = await idb.get('videos', id);
            if (blob) return URL.createObjectURL(blob);
        }
        return null;
    },

    async deleteDownload(id) {
        await idb.remove('videos', id);
        await idb.remove('metadata', id);
        this.downloadedIds.delete(String(id));
        if (State.view === 'downloads') Router.go('downloads');
    },

    updateUI() {
        if (typeof State !== 'undefined' && State.view === 'downloads' && typeof Views !== 'undefined') {
            Views.renderDownloadsScreen();
        }
        
        // Update any visible progress bars on download buttons
        for (const id in this.activeDownloads) {
            const data = this.activeDownloads[id];
            const progContainer = document.getElementById(`dl-progress-${id}`);
            if (progContainer) {
                const progBar = progContainer.querySelector('div');
                if (progBar) progBar.style.width = `${data.progress}%`;
            }
        }
    }
};

// Initialize early
window.addEventListener('load', () => DownloadManager.init());
