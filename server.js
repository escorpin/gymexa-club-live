// Championship closed on 2026-10-22. All polling and scraping are disabled.
// Historical source and score archive remain available in GitHub.
import http from 'node:http';
const port=Number(process.env.PORT||3000);
const response='Bu yarışma takip sitesi kapatılmıştır. Sonuç arşivi GitHub üzerinde saklanmaktadır.\n';
http.createServer((req,res)=>{
  res.writeHead(410,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
  res.end(response);
}).listen(port,'0.0.0.0',()=>console.log('Archived project; polling disabled'));
