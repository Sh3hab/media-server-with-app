const fs = require('fs');
let c = fs.readFileSync('admin.html', 'utf8');

// Replace class and style
c = c.replace(/class="section-content" style="display: none;"/g, 'class="section hidden"');

// Update onclick handlers in the injected sidebar
c = c.replace(/onclick="showSection\('users'\)"/g, 'onclick="showSection(\\\'users\\\'); loadGroups().then(loadUsers);"');
c = c.replace(/onclick="showSection\('groups'\)"/g, 'onclick="showSection(\\\'groups\\\'); loadGroups();"');
c = c.replace(/onclick="showSection\('history'\)"/g, 'onclick="showSection(\\\'history\\\'); loadUsers();"');

// Remove the window.showSection override since we don't need it and it messes things up
const overrideStart = c.indexOf('const originalShowSection = window.showSection;');
if (overrideStart !== -1) {
    const overrideEnd = c.indexOf('// ==================== End Users & Groups Logic ====================');
    if (overrideEnd !== -1) {
        c = c.slice(0, overrideStart) + c.slice(overrideEnd);
    }
}

fs.writeFileSync('admin.html', c);
