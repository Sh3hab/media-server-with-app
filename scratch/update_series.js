const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, '../server.js');
let content = fs.readFileSync(serverFile, 'utf8');

content = content.replace(
    'enhancedSeries.sort((a, b) => a.order_num - b.order_num);\r\n        res.json(enhancedSeries);',
    'enhancedSeries.sort((a, b) => a.order_num - b.order_num);\n        const finalSeries = await filterContentForUser(enhancedSeries, req.query.userId);\n        res.json(finalSeries);'
);

content = content.replace(
    'enhancedSeries.sort((a, b) => a.order_num - b.order_num);\n        res.json(enhancedSeries);',
    'enhancedSeries.sort((a, b) => a.order_num - b.order_num);\n        const finalSeries = await filterContentForUser(enhancedSeries, req.query.userId);\n        res.json(finalSeries);'
);

content = content.replace(
    'enhancedMovies.sort((a, b) => a.order_num - b.order_num);\r\n        res.json(enhancedMovies);',
    'enhancedMovies.sort((a, b) => a.order_num - b.order_num);\n        const finalMovies = await filterContentForUser(enhancedMovies, req.query.userId);\n        res.json(finalMovies);'
);

content = content.replace(
    'enhancedMovies.sort((a, b) => a.order_num - b.order_num);\n        res.json(enhancedMovies);',
    'enhancedMovies.sort((a, b) => a.order_num - b.order_num);\n        const finalMovies = await filterContentForUser(enhancedMovies, req.query.userId);\n        res.json(finalMovies);'
);

fs.writeFileSync(serverFile, content);
console.log('Endpoints updated.');
