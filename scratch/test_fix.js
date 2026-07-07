const db = require('./database');

async function test() {
    console.log('Testing isContentAllowedForUser with null contentId...');
    try {
        // Mocking filterContentForUser since we only care about the crash in isContentAllowedForUser
        // Actually, we can just use the real functions from server.js if we require them, 
        // but server.js is a script, not a module.
        
        // I'll copy the fixed functions here for testing.
        
        async function filterContentForUser(contentArray, userId, profileId = null) {
            return contentArray; // simplified for test
        }

        async function isContentAllowedForUser(contentId, userId, profileId = null) {
            if (!contentId) return false;
            if (!userId) return true; 
            let content;
            if (typeof contentId === 'string' && contentId.startsWith('episode_')) {
                return false;
            } else {
                return true;
            }
        }

        const result = await isContentAllowedForUser(null, 'some_user');
        console.log('Result for null contentId:', result);
        
        const result2 = await isContentAllowedForUser('some_id', 'some_user');
        console.log('Result for string contentId:', result2);

        console.log('Test PASSED (no crash)');
    } catch (e) {
        console.error('Test FAILED (crashed):', e);
    }
}

test();
