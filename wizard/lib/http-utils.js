const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function collectJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let done = false;

    const finishReject = (err) => {
      if (done) return;
      done = true;
      reject(err);
    };

    const finishResolve = (payload) => {
      if (done) return;
      done = true;
      resolve(payload);
    };

    req.on('data', (chunk) => {
      if (done) return;
      body += chunk;
      if (body.length > 1024 * 1024) finishReject(new Error('請求內容過大'));
    });

    req.on('end', () => {
      if (done) return;
      if (!body) {
        finishResolve({});
        return;
      }

      try {
        finishResolve(JSON.parse(body));
      } catch (_) {
        finishReject(new Error('JSON 格式錯誤'));
      }
    });

    req.on('error', finishReject);
  });
}

function serveStaticFile(res, filePath) {
  if (!fs.existsSync(filePath)) return false;

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(content);
  return true;
}

module.exports = {
  sendJson,
  collectJsonBody,
  serveStaticFile
};
