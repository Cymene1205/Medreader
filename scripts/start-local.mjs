import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pidFile=path.join(root,'data/server.pid');
const server=path.join(root,'.next/standalone/server.js');
let pid=Number(fs.existsSync(pidFile)?fs.readFileSync(pidFile,'utf8'):0);
const command=pid>0?spawnSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).stdout.trim():'';
const cwd=pid>0?spawnSync('/usr/sbin/lsof',['-a','-p',String(pid),'-d','cwd','-Fn'],{encoding:'utf8'}).stdout:'';
const owned=pid>0 && cwd.split('\n').includes('n'+path.dirname(server)) && (command.includes(server)||command.startsWith('next-server '));
if(process.argv[2]==='stop') {
 if(owned){process.kill(pid,'SIGTERM');fs.rmSync(pidFile,{force:true});console.log('本地 MedReader 已停止');}
 else console.log('本地服务当前未运行');
 process.exit(0);
}
if(!owned) {
 try{let r=await fetch('http://127.0.0.1:3000/login',{signal:AbortSignal.timeout(1000)});if(r){console.error('3000 端口已被其他服务占用，请先确认该服务。');process.exit(1);}}catch{}
 if(!fs.existsSync(server)){console.error('请先运行 npm run build');process.exit(1);}
 const log=fs.openSync(path.join(root,'data/local-server.log'),'a');
 const child=spawn(process.execPath,['--env-file='+path.join(root,'.env'),server],{cwd:root,env:{...process.env,PORT:'3000',HOSTNAME:'127.0.0.1',NODE_ENV:'production'},detached:true,stdio:['ignore',log,log]});
 child.unref();fs.closeSync(log);fs.writeFileSync(pidFile,String(child.pid));
 for(let i=0;i<30;i++){try{await fetch('http://127.0.0.1:3000/login');break;}catch{await new Promise(r=>setTimeout(r,300));}}
}
const demo=fs.existsSync(path.join(root,'data/demo-paper-id.txt'))?fs.readFileSync(path.join(root,'data/demo-paper-id.txt'),'utf8').trim():'';
const url='http://localhost:3000/app'+(demo?'?paperId='+demo:'');
console.log('MedReader 已启动：'+url);
spawnSync('/usr/bin/open',[url]);
