import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('notes.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL)');
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/health') { response.end('ready'); return; }
    if (request.url === '/api/notes' && request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(db.prepare('SELECT id, text FROM notes ORDER BY id').all())); return;
    }
    if (request.url === '/api/notes' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 4096) { response.writeHead(413).end(); return; }
      }
      const { text }: { text: string } = JSON.parse(body);
      if (typeof text !== 'string' || !text.trim() || text.length > 200) { response.writeHead(400).end(); return; }
      db.prepare('INSERT INTO notes (text) VALUES (?)').run(text.trim());
      response.writeHead(201).end(); return;
    }
    if (request.url === '/' && request.method === 'GET') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(readFileSync(new URL('./index.html', import.meta.url))); return;
    }
    response.writeHead(404).end();
  } catch { response.writeHead(400).end('Invalid request'); }
});
server.listen(3000, '0.0.0.0', () => console.log('Notes frontend and API ready on port 3000'));
