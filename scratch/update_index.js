const fs = require('fs');
const path = require('path');

const indexFile = path.join(__dirname, '../index.html');
let content = fs.readFileSync(indexFile, 'utf8');

// 1. Add Login Modal HTML before </body>
const loginModalHtml = `
    <!-- Login Modal -->
    <div id="login-modal" class="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex items-center justify-center transition-all duration-300" style="display: none;">
        <div class="bg-[#12141c] border border-white/10 p-8 rounded-2xl shadow-2xl max-w-sm w-full mx-4">
            <h2 class="text-2xl font-black text-white text-center mb-6">تسجيل الدخول</h2>
            <form id="login-form" onsubmit="handleLogin(event)">
                <div class="mb-4">
                    <label class="block text-gray-400 text-sm font-bold mb-2 text-right">اسم المستخدم</label>
                    <input type="text" id="login-username" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary text-right" required>
                </div>
                <div class="mb-6">
                    <label class="block text-gray-400 text-sm font-bold mb-2 text-right">كلمة المرور</label>
                    <input type="password" id="login-password" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary text-right" required>
                </div>
                <button type="submit" class="w-full bg-primary text-black font-black py-3 rounded-xl hover:bg-white transition-colors shadow-[0_0_15px_rgba(27,214,142,0.3)]">دخول</button>
                <div id="login-error" class="text-red-500 text-sm font-bold mt-4 text-center hidden"></div>
            </form>
        </div>
    </div>
`;

if (!content.includes('id="login-modal"')) {
    content = content.replace('</body>', loginModalHtml + '\n</body>');
}

// 2. Add Login Logic to script
const loginLogic = `
        async function handleLogin(e) {
            e.preventDefault();
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;
            const errDiv = document.getElementById('login-error');
            
            try {
                const res = await fetch('/api/users/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                
                if (data.success) {
                    saveSession({
                        userId: data.user.id,
                        username: data.user.username,
                        name: data.user.name,
                        age: data.user.age
                    });
                    document.getElementById('login-modal').style.display = 'none';
                    Router.go('home'); // Reload content with user constraints
                } else {
                    errDiv.innerText = data.error || 'فشل تسجيل الدخول';
                    errDiv.classList.remove('hidden');
                }
            } catch (err) {
                errDiv.innerText = 'حدث خطأ في الاتصال';
                errDiv.classList.remove('hidden');
            }
        }

        // Global check on load
        window.addEventListener('DOMContentLoaded', () => {
            if (!loadSession()) {
                document.getElementById('login-modal').style.display = 'flex';
            }
        });

        // Intercept API fetch calls
        const originalFetch = window.fetch;
        window.fetch = function() {
            let [resource, config] = arguments;
            if (typeof resource === 'string' && resource.startsWith(API_BASE)) {
                if (currentSession && currentSession.userId) {
                    const separator = resource.includes('?') ? '&' : '?';
                    resource += separator + 'userId=' + currentSession.userId;
                }
            }
            return originalFetch(resource, config);
        };
        
        // Watch History Logic
        async function logWatchHistory(contentId, contentType, progress) {
            if (!currentSession || !currentSession.userId) return;
            try {
                await fetch('/api/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: currentSession.userId,
                        contentId: contentId,
                        contentType: contentType,
                        progress: progress
                    })
                });
            } catch (err) {
                console.error('Failed to log history', err);
            }
        }
`;

if (!content.includes('handleLogin(e)')) {
    content = content.replace('const API_BASE = \'/api\';', 'const API_BASE = \'/api\';\n' + loginLogic);
}

// 3. Inject Watch History into PlayerEngine
// The player saves progress locally using localStorage.setItem(\`prog_\${State.params.id}\`, percent)
// We will also call logWatchHistory there.

if (!content.includes('logWatchHistory(State.params.id')) {
    content = content.replace('localStorage.setItem(`prog_${State.params.id}`, percent);', 
        'localStorage.setItem(`prog_${State.params.id}`, percent);\n                    logWatchHistory(State.params.id, State.params.type, Math.round(this.player.currentTime() / 60));');
}

fs.writeFileSync(indexFile, content);
console.log('index.html updated with login logic and watch history.');
