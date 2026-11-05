import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=['src','scripts'].flatMap(folder=>fs.readdirSync(path.join(root,folder)).filter(n=>/\.(mjs|cjs)$/.test(n)).map(n=>path.join(folder,n)));
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{cwd:root,encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr);process.exit(1);}}
console.log(`Syntax checked ${files.length} JavaScript modules.`);
