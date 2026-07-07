// ==================== مشغل فيديو متطور مثل YouTube ====================
const UltraPlayer = {
  instance: null,
  container: null,
  video: null,
  settings: {
    quality: 'auto',
    speed: 1.0,
    subtitle: 'none',
    volume: 1,
    muted: false,
    loop: false,
    autoplay: true
  },
  subtitles: [],
  qualities: [],
  shortcuts: [
    { key: ' ', action: 'playpause', description: 'تشغيل/إيقاف' },
    { key: 'f', action: 'fullscreen', description: 'ملء الشاشة' },
    { key: 'm', action: 'mute', description: 'كتم الصوت' },
    { key: 'arrowright', action: 'forward', description: 'تقدم 10 ثوان' },
    { key: 'arrowleft', action: 'backward', description: 'رجوع 10 ثوان' },
    { key: 'arrowup', action: 'volumeup', description: 'رفع الصوت' },
    { key: 'arrowdown', action: 'volumedown', description: 'خفض الصوت' },
    { key: '>', action: 'speedup', description: 'زيادة السرعة' },
    { key: '<', action: 'speeddown', description: 'تقليل السرعة' },
    { key: 'c', action: 'subtitles', description: 'الترجمات' },
    { key: 'i', action: 'pip', description: 'صورة داخل صورة' }
  ],

  async init(containerId, videoUrl, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.container.innerHTML = this.generatePlayerHTML(videoUrl);
    this.video = this.container.querySelector('video');
    this.instance = this.video;

    await this.loadSubtitles(options.contentId);
    this.loadQualities(options.qualities);
    this.initEventListeners();
    this.initControls();
    this.initKeyboardShortcuts();
    this.loadUserPreferences();
    this.initProgressTracking(options.contentId, options.contentType);
    
    return this;
  },

  generatePlayerHTML(videoUrl) {
    return `
      <div class="ultra-player-container relative w-full h-full bg-black">
        <video class="ultra-player-video w-full h-full" preload="auto">
          <source src="${videoUrl}" type="video/mp4">
        </video>
        
        <div class="ultra-player-controls absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300">
          
          <!-- شريط التقدم -->
          <div class="progress-container px-4 mb-2">
            <div class="relative h-1.5 bg-white/20 rounded-full cursor-pointer group">
              <div class="progress-buffer absolute inset-0 bg-white/30 rounded-full" style="width: 0%"></div>
              <div class="progress-played absolute inset-0 bg-primary rounded-full" style="width: 0%"></div>
              <div class="progress-thumb absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity" style="left: 0%"></div>
            </div>
            <div class="flex justify-between mt-1 text-[10px] text-white/60">
              <span class="time-current">00:00</span>
              <span class="time-duration">00:00</span>
            </div>
          </div>

          <!-- أزرار التحكم -->
          <div class="controls-bar flex items-center justify-between p-4">
            <div class="flex items-center gap-4">
              <button class="play-pause-btn w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
                <i class="fa-solid fa-play text-2xl"></i>
              </button>
              
              <div class="volume-control relative group">
                <button class="volume-btn w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
                  <i class="fa-solid fa-volume-high text-xl"></i>
                </button>
                <div class="volume-slider absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-8 h-24 bg-surface rounded-lg p-2 hidden group-hover:flex group-hover:flex-col items-center">
                  <input type="range" min="0" max="100" value="100" class="volume-range vertical w-full h-1 bg-white/20 rounded-full appearance-none">
                </div>
              </div>

              <span class="time-display text-sm font-mono">
                <span class="current-time">00:00</span>
                <span class="text-white/40">/</span>
                <span class="duration">00:00</span>
              </span>
            </div>

            <div class="flex items-center gap-4">
              <!-- سرعة التشغيل -->
              <div class="speed-control relative group">
                <button class="speed-btn px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm font-bold">
                  ${this.settings.speed}x
                </button>
                <div class="speed-menu absolute bottom-full left-0 mb-2 w-40 bg-surface rounded-xl p-2 hidden group-hover:block">
                  ${[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map(speed => `
                    <button class="speed-option w-full text-right px-4 py-2 rounded-lg hover:bg-white/10 transition-colors ${this.settings.speed === speed ? 'text-primary bg-primary/10' : ''}" data-speed="${speed}">
                      ${speed}x
                    </button>
                  `).join('')}
                </div>
              </div>

              <!-- جودة التشغيل -->
              <div class="quality-control relative group">
                <button class="quality-btn px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm font-bold">
                  ${this.settings.quality}
                </button>
                <div class="quality-menu absolute bottom-full left-0 mb-2 w-48 bg-surface rounded-xl p-2 hidden group-hover:block">
                  <button class="quality-option w-full text-right px-4 py-2 rounded-lg hover:bg-white/10 transition-colors" data-quality="auto">
                    تلقائي
                  </button>
                  ${this.qualities.map(q => `
                    <button class="quality-option w-full text-right px-4 py-2 rounded-lg hover:bg-white/10 transition-colors" data-quality="${q.label}">
                      ${q.label} (${q.height}p)
                    </button>
                  `).join('')}
                </div>
              </div>

              <!-- الترجمات -->
              <div class="subtitle-control relative group">
                <button class="subtitle-btn w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
                  <i class="fa-solid fa-closed-captioning text-xl"></i>
                </button>
                <div class="subtitle-menu absolute bottom-full left-0 mb-2 w-56 bg-surface rounded-xl p-2 hidden group-hover:block max-h-96 overflow-y-auto">
                  <button class="subtitle-option w-full text-right px-4 py-2 rounded-lg hover:bg-white/10 transition-colors" data-lang="none">
                    <i class="fa-solid fa-ban ml-2"></i>
                    بدون ترجمة
                  </button>
                  ${this.subtitles.map(sub => `
                    <button class="subtitle-option w-full text-right px-4 py-2 rounded-lg hover:bg-white/10 transition-colors" data-url="${sub.url}" data-lang="${sub.language}">
                      <span class="inline-block w-6 ml-2">${this.getFlagEmoji(sub.language)}</span>
                      ${sub.label}
                    </button>
                  `).join('')}
                </div>
              </div>

              <!-- أزرار إضافية -->
              <button class="screenshot-btn w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
                <i class="fa-solid fa-camera text-xl"></i>
              </button>

              <button class="pip-btn w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
                <i class="fa-solid fa-window-restore text-xl"></i>
              </button>

              <button class="fullscreen-btn w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
                <i class="fa-solid fa-expand text-xl"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- عرض الترجمة -->
        <div class="subtitle-display absolute bottom-24 left-1/2 -translate-x-1/2 text-center text-white text-xl drop-shadow-2xl px-6 py-3 bg-black/60 rounded-2xl backdrop-blur max-w-3xl">
          <span class="subtitle-text"></span>
        </div>

        <!-- سرعة التشغيل المؤقتة (مثل YouTube) -->
        <div class="speed-indicator absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/80 text-primary px-8 py-4 rounded-2xl text-4xl font-black hidden">
          2x
        </div>

        <!-- بحث متقدم -->
        <div class="search-overlay absolute inset-0 bg-black/90 hidden">
          <div class="max-w-2xl mx-auto mt-20">
            <div class="relative">
              <i class="fa-solid fa-search absolute right-6 top-1/2 -translate-y-1/2 text-gray-500"></i>
              <input type="text" class="search-input w-full bg-surface border-2 border-white/10 rounded-2xl py-5 pr-16 pl-6 text-xl focus:border-primary/50 focus:outline-none transition-all" placeholder="ابحث في الفيديو..." autofocus>
            </div>
            <div class="search-results mt-4 hidden"></div>
          </div>
        </div>
      </div>
    `;
  },

  initEventListeners() {
    // تحديث الوقت
    this.video.addEventListener('timeupdate', () => this.updateProgress());
    this.video.addEventListener('loadedmetadata', () => this.updateDuration());
    this.video.addEventListener('ended', () => this.onEnded());
    this.video.addEventListener('waiting', () => this.showLoading());
    this.video.addEventListener('playing', () => this.hideLoading());

    // أحداث الشريط
    const progressBar = this.container.querySelector('.progress-container');
    progressBar?.addEventListener('click', (e) => this.seek(e));

    // زر الصورة داخل صورة
    this.container.querySelector('.pip-btn')?.addEventListener('click', () => this.togglePictureInPicture());

    // لقطة شاشة
    this.container.querySelector('.screenshot-btn')?.addEventListener('click', () => this.takeScreenshot());
  },

  initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // تجاهل إذا كان المستخدم يكتب في input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();
      const shortcut = this.shortcuts.find(s => s.key === key || s.key === e.code?.toLowerCase());

      if (shortcut) {
        e.preventDefault();
        this.handleShortcut(shortcut.action);
        this.showShortcutHint(shortcut.description);
      }
    });
  },

  handleShortcut(action) {
    switch (action) {
      case 'playpause':
        this.togglePlay();
        break;
      case 'fullscreen':
        this.toggleFullscreen();
        break;
      case 'mute':
        this.toggleMute();
        break;
      case 'forward':
        this.video.currentTime += 10;
        this.showToast('⏩ +10 ثوان');
        break;
      case 'backward':
        this.video.currentTime -= 10;
        this.showToast('⏪ -10 ثوان');
        break;
      case 'volumeup':
        this.video.volume = Math.min(1, this.video.volume + 0.1);
        break;
      case 'volumedown':
        this.video.volume = Math.max(0, this.video.volume - 0.1);
        break;
      case 'speedup':
        this.video.playbackRate = Math.min(3, this.video.playbackRate + 0.25);
        this.showSpeedIndicator();
        break;
      case 'speeddown':
        this.video.playbackRate = Math.max(0.5, this.video.playbackRate - 0.25);
        this.showSpeedIndicator();
        break;
      case 'subtitles':
        this.toggleSubtitles();
        break;
      case 'pip':
        this.togglePictureInPicture();
        break;
    }
  },

  async loadSubtitles(contentId) {
    try {
      this.subtitles = await API.subtitles.get(contentId);
    } catch (error) {
      console.error('Failed to load subtitles:', error);
    }
  },

  loadQualities(qualities) {
    this.qualities = qualities || [
      { height: 2160, label: '4K' },
      { height: 1080, label: '1080p' },
      { height: 720, label: '720p' },
      { height: 480, label: '480p' }
    ];
  },

  async initProgressTracking(contentId, contentType) {
    if (!contentId || !App.state.token) return;

    try {
      const progress = await API.watch.getProgress(contentId);
      if (progress > 5 && progress < 95) {
        this.video.currentTime = (progress / 100) * this.video.duration;
      }
    } catch (error) {
      console.error('Failed to load progress:', error);
    }

    // حفظ التقدم كل 5 ثواني
    setInterval(() => {
      if (this.video && !this.video.paused) {
        const progress = (this.video.currentTime / this.video.duration) * 100;
        API.watch.saveProgress({
          contentId,
          contentType,
          progress,
          duration: this.video.duration
        });
      }
    }, 5000);
  },

  togglePictureInPicture() {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
    } else {
      this.video.requestPictureInPicture();
    }
  },

  async takeScreenshot() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = this.video.videoWidth;
      canvas.height = this.video.videoHeight;
      canvas.getContext('2d').drawImage(this.video, 0, 0, canvas.width, canvas.height);
      
      const link = document.createElement('a');
      link.download = `screenshot-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();

      this.showToast('📸 تم حفظ لقطة الشاشة');
    } catch (error) {
      console.error('Failed to take screenshot:', error);
    }
  },

  showSpeedIndicator() {
    const indicator = this.container.querySelector('.speed-indicator');
    indicator.textContent = `${this.video.playbackRate}x`;
    indicator.classList.remove('hidden');
    
    clearTimeout(this.speedTimeout);
    this.speedTimeout = setTimeout(() => {
      indicator.classList.add('hidden');
    }, 800);
  },

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed top-20 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur text-white px-6 py-3 rounded-2xl text-sm z-[9999] border border-primary/30';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 2000);
  },

  showShortcutHint(action) {
    const hint = document.createElement('div');
    hint.className = 'fixed bottom-40 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur text-white px-4 py-2 rounded-lg text-xs';
    hint.textContent = action;
    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 800);
  },

  loadUserPreferences() {
    const prefs = App.state.user?.preferences;
    if (prefs) {
      this.settings.speed = prefs.speed || 1;
      this.settings.quality = prefs.quality || 'auto';
      this.video.playbackRate = this.settings.speed;
      this.video.volume = prefs.volume || 1;
    }
  }
};

window.UltraPlayer = UltraPlayer;