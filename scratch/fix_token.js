const fs = require('fs');
let c = fs.readFileSync('admin.html', 'utf8');
c = c.replace(/ADMIN_TOKEN/g, "localStorage.getItem('adminToken')");
fs.writeFileSync('admin.html', c);
