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
    const navSectionRegex = /<div class="nav-section">\s*<div class="nav-section-title">المحتوى<\/div>/;
    content = content.replace(navSectionRegex, sidebarInjection + '<div class="nav-section">\n                    <div class="nav-section-title">المحتوى</div>');
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
                                <div class="form-group" style="grid-column: 1 / -1;">
                                    <label class="form-label">حظر تصنيفات معينة (مفصولة بفاصلة)</label>
                                    <input type="text" id="user-blocked-genres" class="form-input" placeholder="رعب, جريمة, رومانسي">
                                </div>
                                <div class="form-group" style="grid-column: 1 / -1;">
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
    const dashboardRegex = /<!-- =+ 1\. لوحة التحكم =+ -->/;
    if (dashboardRegex.test(content)) {
        content = content.replace(dashboardRegex, sectionsInjection + '\n\n            <!-- ==================== 1. لوحة التحكم ==================== -->');
    } else {
        // Fallback: inject right after <div class="main-content">
        const mainContentRegex = /<div class="main-content">/;
        content = content.replace(mainContentRegex, '<div class="main-content">\n' + sectionsInjection);
    }
}

fs.writeFileSync(adminFile, content);
console.log('admin.html updated successfully.');
