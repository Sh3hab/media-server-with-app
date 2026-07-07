const fs = require('fs');
const path = require('path');

const adminFile = path.join(__dirname, '../admin.html');
let content = fs.readFileSync(adminFile, 'utf8');

// 1. Inject Sidebar Items
const sidebarInjection = `
                <div class="nav-section">
                    <div class="nav-section-title">المستخدمين والرقابة</div>
                    <div class="nav-item" onclick="showSection('users')">
                        <i class="fas fa-users"></i>
                        <span class="nav-text">إدارة المستخدمين</span>
                    </div>
                    <div class="nav-item" onclick="showSection('groups')">
                        <i class="fas fa-user-shield"></i>
                        <span class="nav-text">الفئات العمرية</span>
                    </div>
                    <div class="nav-item" onclick="showSection('history')">
                        <i class="fas fa-history"></i>
                        <span class="nav-text">سجل المشاهدات</span>
                    </div>
                </div>
`;
if (!content.includes('showSection(\'users\')')) {
    content = content.replace('<div class="nav-section">\n                    <div class="nav-section-title">المحتوى</div>', sidebarInjection + '<div class="nav-section">\n                    <div class="nav-section-title">المحتوى</div>');
}

// 2. Inject HTML Sections
const sectionsInjection = `
            <!-- Users Section -->
            <div id="users-section" class="section-content" style="display: none;">
                <div class="page-header">
                    <h2 class="page-title">إدارة المستخدمين</h2>
                    <div class="page-actions">
                        <button class="btn-primary" onclick="openUserModal()"><i class="fas fa-plus"></i> إضافة مستخدم</button>
                    </div>
                </div>
                <div class="card">
                    <div class="table-container">
                        <table class="data-table" id="users-table">
                            <thead>
                                <tr>
                                    <th>الصورة</th>
                                    <th>الاسم</th>
                                    <th>اسم المستخدم</th>
                                    <th>العمر</th>
                                    <th>الفئة العمرية</th>
                                    <th>تاريخ الإنشاء</th>
                                    <th>إجراءات</th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Groups Section -->
            <div id="groups-section" class="section-content" style="display: none;">
                <div class="page-header">
                    <h2 class="page-title">الفئات العمرية</h2>
                    <div class="page-actions">
                        <button class="btn-primary" onclick="openGroupModal()"><i class="fas fa-plus"></i> إضافة فئة</button>
                    </div>
                </div>
                <div class="card">
                    <div class="table-container">
                        <table class="data-table" id="groups-table">
                            <thead>
                                <tr>
                                    <th>اسم الفئة</th>
                                    <th>من عمر</th>
                                    <th>إلى عمر</th>
                                    <th>إجراءات</th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- History Section -->
            <div id="history-section" class="section-content" style="display: none;">
                <div class="page-header">
                    <h2 class="page-title">سجل المشاهدات</h2>
                    <div class="page-actions">
                        <select id="history-user-select" class="form-select" style="width:200px" onchange="loadWatchHistory(this.value)">
                            <option value="">اختر المستخدم</option>
                        </select>
                    </div>
                </div>
                <div class="card">
                    <div class="table-container">
                        <table class="data-table" id="history-table">
                            <thead>
                                <tr>
                                    <th>المحتوى</th>
                                    <th>النوع</th>
                                    <th>وقت المشاهدة</th>
                                    <th>التقدم</th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Modals -->
            <!-- User Modal -->
            <div id="user-modal" class="modal">
                <div class="modal-content" style="max-width: 600px;">
                    <div class="modal-header">
                        <h3 class="modal-title" id="user-modal-title">إضافة مستخدم</h3>
                        <button class="close-modal" onclick="closeModal('user-modal')">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="user-form">
                            <input type="hidden" id="user-id">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label class="form-label">الاسم</label>
                                    <input type="text" id="user-name" class="form-input" required>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">اسم المستخدم (للدخول)</label>
                                    <input type="text" id="user-username" class="form-input" required>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">كلمة المرور</label>
                                    <input type="text" id="user-password" class="form-input" required>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">العمر</label>
                                    <input type="number" id="user-age" class="form-input" value="0" required>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">الفئة العمرية (اختياري)</label>
                                    <select id="user-group" class="form-select"></select>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">حظر تصنيفات معينة (مفصولة بفاصلة)</label>
                                    <input type="text" id="user-blocked-genres" class="form-input" placeholder="رعب, جريمة, رومانسي">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">حظر عناوين معينة (مفصولة بفاصلة)</label>
                                    <input type="text" id="user-blocked-titles" class="form-input" placeholder="Titanic, Saw">
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary" onclick="closeModal('user-modal')">إلغاء</button>
                        <button class="btn-primary" onclick="saveUser()">حفظ</button>
                    </div>
                </div>
            </div>

            <!-- Group Modal -->
            <div id="group-modal" class="modal">
                <div class="modal-content" style="max-width: 600px;">
                    <div class="modal-header">
                        <h3 class="modal-title" id="group-modal-title">إضافة فئة عمرية</h3>
                        <button class="close-modal" onclick="closeModal('group-modal')">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="group-form">
                            <input type="hidden" id="group-id">
                            <div class="form-group">
                                <label class="form-label">اسم الفئة</label>
                                <input type="text" id="group-name" class="form-input" placeholder="مثال: أطفال" required>
                            </div>
                            <div class="form-grid">
                                <div class="form-group">
                                    <label class="form-label">من عمر</label>
                                    <input type="number" id="group-min-age" class="form-input" value="0" required>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">إلى عمر</label>
                                    <input type="number" id="group-max-age" class="form-input" value="12" required>
                                </div>
                            </div>
                            <div class="form-group">
                                <label class="form-label">التصنيفات المحظورة (مفصولة بفاصلة)</label>
                                <input type="text" id="group-blocked-genres" class="form-input" placeholder="رعب, جريمة, رومانسي">
                            </div>
                            <div class="form-group">
                                <label class="form-label">العناوين المحظورة (مفصولة بفاصلة)</label>
                                <input type="text" id="group-blocked-titles" class="form-input" placeholder="Titanic, Saw">
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary" onclick="closeModal('group-modal')">إلغاء</button>
                        <button class="btn-primary" onclick="saveGroup()">حفظ</button>
                    </div>
                </div>
            </div>
`;

if (!content.includes('id="users-section"')) {
    content = content.replace('<!-- ==================== 1. لوحة التحكم ==================== -->', sectionsInjection + '\n\n            <!-- ==================== 1. لوحة التحكم ==================== -->');
}

// 3. Inject JS Logic
const jsInjection = `
// ==================== Users & Groups Logic ====================
let allGroups = [];

async function loadGroups() {
    try {
        const res = await fetch('/api/admin/groups', { headers: { 'x-admin-token': ADMIN_TOKEN } });
        const groups = await res.json();
        allGroups = groups;
        
        const tbody = document.querySelector('#groups-table tbody');
        if(tbody) {
            tbody.innerHTML = groups.map(g => \`
                <tr>
                    <td>\${g.name}</td>
                    <td>\${g.min_age}</td>
                    <td>\${g.max_age}</td>
                    <td>
                        <button class="action-btn btn-edit" onclick="editGroup('\${g.id}')"><i class="fas fa-edit"></i></button>
                        <button class="action-btn btn-delete" onclick="deleteGroup('\${g.id}')"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            \`).join('');
        }

        const select = document.getElementById('user-group');
        if(select) {
            select.innerHTML = '<option value="">بدون فئة</option>' + groups.map(g => \`<option value="\${g.id}">\${g.name}</option>\`).join('');
        }
    } catch(e) { console.error(e); }
}

async function loadUsers() {
    try {
        const res = await fetch('/api/admin/users', { headers: { 'x-admin-token': ADMIN_TOKEN } });
        const users = await res.json();
        
        const tbody = document.querySelector('#users-table tbody');
        if(tbody) {
            tbody.innerHTML = users.map(u => {
                const group = allGroups.find(g => g.id === u.groupId);
                return \`
                <tr>
                    <td><img src="\${u.avatar || 'placeholder.jpg'}" class="actor-image-small"></td>
                    <td>\${u.name || ''}</td>
                    <td>\${u.username || ''}</td>
                    <td>\${u.age || 0}</td>
                    <td>\${group ? group.name : 'بدون فئة'}</td>
                    <td>\${new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                        <button class="action-btn btn-view" onclick="viewUserHistory('\${u.id}')"><i class="fas fa-history"></i></button>
                        <button class="action-btn btn-edit" onclick="editUser('\${u.id}', '\${encodeURIComponent(JSON.stringify(u))}')"><i class="fas fa-edit"></i></button>
                        <button class="action-btn btn-delete" onclick="deleteUser('\${u.id}')"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            \`}).join('');
        }

        const histSelect = document.getElementById('history-user-select');
        if(histSelect) {
            histSelect.innerHTML = '<option value="">اختر المستخدم</option>' + users.map(u => \`<option value="\${u.id}">\${u.name}</option>\`).join('');
        }
    } catch(e) { console.error(e); }
}

function openUserModal() {
    document.getElementById('user-form').reset();
    document.getElementById('user-id').value = '';
    document.getElementById('user-modal-title').innerText = 'إضافة مستخدم';
    document.getElementById('user-modal').style.display = 'flex';
}

function editUser(id, userDataEnc) {
    const u = JSON.parse(decodeURIComponent(userDataEnc));
    document.getElementById('user-id').value = u.id;
    document.getElementById('user-name').value = u.name || '';
    document.getElementById('user-username').value = u.username || '';
    document.getElementById('user-password').value = u.password || '';
    document.getElementById('user-age').value = u.age || 0;
    document.getElementById('user-group').value = u.groupId || '';
    
    let custom = {titles:[], genres:[]};
    try { custom = JSON.parse(u.custom_restrictions || '{"titles":[],"genres":[]}'); }catch(e){}
    document.getElementById('user-blocked-genres').value = (custom.genres || []).join(', ');
    document.getElementById('user-blocked-titles').value = (custom.titles || []).join(', ');
    
    document.getElementById('user-modal-title').innerText = 'تعديل مستخدم';
    document.getElementById('user-modal').style.display = 'flex';
}

async function saveUser() {
    const id = document.getElementById('user-id').value;
    const data = {
        name: document.getElementById('user-name').value,
        username: document.getElementById('user-username').value,
        password: document.getElementById('user-password').value,
        age: parseInt(document.getElementById('user-age').value),
        groupId: document.getElementById('user-group').value || null,
        custom_restrictions: JSON.stringify({
            genres: document.getElementById('user-blocked-genres').value.split(',').map(s=>s.trim()).filter(Boolean),
            titles: document.getElementById('user-blocked-titles').value.split(',').map(s=>s.trim()).filter(Boolean)
        })
    };
    
    const method = id ? 'PUT' : 'POST';
    const url = '/api/admin/users' + (id ? '/'+id : '');
    
    await fetch(url, {
        method, headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
        body: JSON.stringify(data)
    });
    
    closeModal('user-modal');
    loadUsers();
}

async function deleteUser(id) {
    if(confirm('هل أنت متأكد من حذف هذا المستخدم؟')) {
        await fetch('/api/admin/users/'+id, { method:'DELETE', headers: {'x-admin-token': ADMIN_TOKEN} });
        loadUsers();
    }
}

function openGroupModal() {
    document.getElementById('group-form').reset();
    document.getElementById('group-id').value = '';
    document.getElementById('group-modal-title').innerText = 'إضافة فئة';
    document.getElementById('group-modal').style.display = 'flex';
}

async function editGroup(id) {
    const g = allGroups.find(x => x.id === id);
    if(!g) return;
    document.getElementById('group-id').value = g.id;
    document.getElementById('group-name').value = g.name || '';
    document.getElementById('group-min-age').value = g.min_age || 0;
    document.getElementById('group-max-age').value = g.max_age || 12;
    
    document.getElementById('group-blocked-genres').value = JSON.parse(g.blocked_genres||'[]').join(', ');
    document.getElementById('group-blocked-titles').value = JSON.parse(g.blocked_titles||'[]').join(', ');
    
    document.getElementById('group-modal-title').innerText = 'تعديل فئة';
    document.getElementById('group-modal').style.display = 'flex';
}

async function saveGroup() {
    const id = document.getElementById('group-id').value;
    const data = {
        name: document.getElementById('group-name').value,
        min_age: parseInt(document.getElementById('group-min-age').value),
        max_age: parseInt(document.getElementById('group-max-age').value),
        blocked_genres: JSON.stringify(document.getElementById('group-blocked-genres').value.split(',').map(s=>s.trim()).filter(Boolean)),
        blocked_titles: JSON.stringify(document.getElementById('group-blocked-titles').value.split(',').map(s=>s.trim()).filter(Boolean))
    };
    
    const method = id ? 'PUT' : 'POST';
    const url = '/api/admin/groups' + (id ? '/'+id : '');
    
    await fetch(url, {
        method, headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
        body: JSON.stringify(data)
    });
    
    closeModal('group-modal');
    loadGroups();
}

async function deleteGroup(id) {
    if(confirm('هل أنت متأكد من حذف هذه الفئة؟')) {
        await fetch('/api/admin/groups/'+id, { method:'DELETE', headers: {'x-admin-token': ADMIN_TOKEN} });
        loadGroups();
        loadUsers();
    }
}

function viewUserHistory(userId) {
    showSection('history');
    document.getElementById('history-user-select').value = userId;
    loadWatchHistory(userId);
}

async function loadWatchHistory(userId) {
    if(!userId) {
        document.querySelector('#history-table tbody').innerHTML = '';
        return;
    }
    try {
        const res = await fetch('/api/history/'+userId, { headers: { 'x-admin-token': ADMIN_TOKEN } });
        const history = await res.json();
        
        // Need to fetch details for contentIds
        const seriesRes = await fetch('/api/series');
        const series = await seriesRes.json();
        const moviesRes = await fetch('/api/movies');
        const movies = await moviesRes.json();
        
        const tbody = document.querySelector('#history-table tbody');
        if(tbody) {
            tbody.innerHTML = history.map(h => {
                let contentName = 'غير معروف';
                if(h.contentType === 'movie') {
                    const m = movies.find(x => x.id === h.contentId);
                    if(m) contentName = m.title;
                } else {
                    const s = series.find(x => x.id === h.contentId);
                    if(s) contentName = s.title;
                    // Note: for episodes it could be mapped as well
                }
                return \`
                <tr>
                    <td>\${contentName} (\${h.contentId})</td>
                    <td>\${h.contentType}</td>
                    <td>\${new Date(h.watchedAt).toLocaleString()}</td>
                    <td>\${h.progress} دقيقة</td>
                </tr>
            \`}).join('');
        }
    } catch(e) { console.error(e); }
}

const originalShowSection = window.showSection;
window.showSection = function(sectionId) {
    if(originalShowSection) originalShowSection(sectionId);
    
    // Hide all
    document.querySelectorAll('.section-content').forEach(el => {
        if(el.id !== sectionId + '-section' && el.id !== sectionId) el.style.display = 'none';
        else el.style.display = 'block';
    });
    
    if(sectionId === 'users' || sectionId === 'users-section') {
        loadGroups().then(loadUsers);
    } else if(sectionId === 'groups' || sectionId === 'groups-section') {
        loadGroups();
    }
};

// ==================== End Users & Groups Logic ====================
`;

if (!content.includes('loadGroups()')) {
    content = content.replace('</script>', jsInjection + '\n</script>');
}

fs.writeFileSync(adminFile, content);
console.log('admin.html updated successfully.');
