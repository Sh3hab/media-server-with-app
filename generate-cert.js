const selfsigned = require('selfsigned');
const fs = require('fs');

async function createCert() {
    try {
        console.log('loading... ');
        
        const attrs = [{ name: 'commonName', value: 'localhost' }];
        
        const pems = await selfsigned.generate(attrs, { days: 365 });

        fs.writeFileSync('server.key', pems.private);
        fs.writeFileSync('server.cert', pems.cert);

        console.log('done server.key and server.cert');
    } catch (error) {
        console.error('Error', error);
    }
}

createCert();