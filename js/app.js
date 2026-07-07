// ==================== التطبيق الرئيسي ====================
const App = {
  state: {
    user: null,
    token: localStorage.getItem('token'),
    view: 'home',
    params: {},
    player: null,
    collections: [],
    watchlist: [],
    history: []
  },

  async init() {
    console.log('🚀 MediaNet Ultra v3.0');
    await this.checkAuth();
    this.initRouter();
    this.initEventListeners();
  },

  async checkAuth() {
    if (this.state.token) {
      try {
        // التحقق من صحة التوكن
        const response = await API.auth.verify();
        if (response.success) {
          this.state.user = response.user;
          await this.loadUserData();
        } else {
          localStorage.removeItem('token');
          this.state.token = null;
        }
      } catch (error) {
        console.error('Auth check failed:', error);
      }
    }
  },

  async loadUserData() {
    try {
      const [watchlist, history, collections] = await Promise.all([
        API.user.getWatchlist(),
        API.user.getHistory(),
        API.user.getCollections()
      ]);
      this.state.watchlist = watchlist;
      this.state.history = history;
      this.state.collections = collections;
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  },

  initRouter() {
    Router.init({
      '/': 'home',
      '/details/:id': 'details',
      '/player/:id': 'player',
      '/actor/:id': 'actor',
      '/profile': 'profile',
      '/collection/:id': 'collection',
      '/search': 'search'
    });
  },

  initEventListeners() {
    // استماع لأحداث التوجيه
    window.addEventListener('popstate', () => Router.handleRoute());
    
    // استماع لتغييرات حالة المستخدم
    window.addEventListener('user-updated', (e) => {
      this.state.user = e.detail.user;
      this.loadUserData();
    });
  },

  async showGuestModal() {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/90 backdrop-blur z-[9999] flex items-center justify-center p-6';
    modal.innerHTML = `
      <div class="bg-surface max-w-md w-full p-8 rounded-3xl border border-white/10 text-right">
        <div class="text-center mb-8">
          <div class="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <i class="fa-solid fa-user text-4xl text-primary"></i>
          </div>
          <h2 class="text-2xl font-black mb-2">حفظ التقدم</h2>
          <p class="text-gray-400 text-sm">أنشئ اسماً لحفظ تقدم مشاهداتك واستكمل من أي جهاز</p>
        </div>

        <div class="space-y-6">
          <div>
            <label class="block text-gray-400 text-xs mb-2 text-right">اختر اسماً</label>
            <div class="relative">
              <i class="fa-solid fa-at absolute right-4 top-1/2 -translate-y-1/2 text-gray-600"></i>
              <input type="text" id="guest-username" 
                     class="w-full bg-obsidian border-2 border-white/5 rounded-2xl py-4 pr-12 pl-4 text-white focus:border-primary/50 focus:outline-none transition-all"
                     placeholder="اسمك (مثل: أحمد)">
            </div>
          </div>

          <button onclick="App.createGuestAccount()" 
                  class="w-full bg-primary text-black py-4 rounded-2xl font-black text-lg hover:scale-[1.02] transition-all">
            <i class="fa-solid fa-play ml-2"></i>
            متابعة كضيف
          </button>

          <div class="relative">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t border-white/10"></div>
            </div>
            <div class="relative flex justify-center">
              <span class="bg-surface px-4 text-gray-500 text-xs">أو</span>
            </div>
          </div>

          <p class="text-center text-gray-500 text-xs">
            لن تحتاج إلى بريد إلكتروني أو كلمة مرور، فقط اسم للمشاهدة
          </p>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  async createGuestAccount() {
    const username = document.getElementById('guest-username')?.value.trim();
    if (!username) {
      UI.toast('الرجاء إدخال اسم', 'error');
      return;
    }

    try {
      const result = await API.auth.createGuest(username);
      if (result.success) {
        localStorage.setItem('token', result.token);
        this.state.user = result.user;
        this.state.token = result.token;
        
        UI.toast(`مرحباً ${username} 🎬`, 'success');
        document.querySelector('.fixed.inset-0')?.remove();
        
        // تحديث الواجهة
        window.dispatchEvent(new CustomEvent('user-updated', { detail: { user: result.user } }));
      }
    } catch (error) {
      UI.toast(error.error || 'حدث خطأ', 'error');
    }
  }
};

// بدء التطبيق
document.addEventListener('DOMContentLoaded', () => App.init());