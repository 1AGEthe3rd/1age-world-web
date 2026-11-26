// Cloudflare-only output. Original GitHub Pages export stays byte-for-byte intact.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const limit=25*1024*1024, out=resolve('dist');
const pack=readFileSync('index.pck');
if(pack.length!==13466052||createHash('sha256').update(pack).digest('hex')!=='21d9844132e57db7edfc56aac03469c273e09245328cce34f03955b0c8af24c2')throw Error('Build 010 pack missing or mismatched; refusing to deploy');
const wasm=readFileSync('index.wasm');
if(wasm.length!==39514754||wasm.readUInt32LE(0)!==0x6d736100)throw Error('Unexpected original Godot engine');
const compressed=gzipSync(wasm,{level:9});
if(compressed.length>limit||!gunzipSync(compressed).equals(wasm))throw Error('Engine compression verification failed');
const hash=createHash('sha256').update(wasm).digest('hex');
const file='world-engine-'+hash.slice(0,16)+'.bin';
rmSync(out,{recursive:true,force:true});mkdirSync(out);
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const p of tracked){
 if(p==='index.wasm'||p==='index.html'||p==='CNAME'||p.startsWith('.')||p.startsWith('scripts/')||p.startsWith('dist/'))continue;
 const source=statSync(p);if(!source.isFile())continue;
 if(source.size>limit)throw Error('Another Cloudflare asset exceeds 25 MiB: '+p);
 const dest=resolve(out,p);if(!dest.startsWith(out+'/'))throw Error('Unsafe output path');
 mkdirSync(dirname(dest),{recursive:true});copyFileSync(p,dest);
}
const original=readFileSync('index.html','utf8'),anchor='<script src="index.js"></script>';
if(original.split(anchor).length!==2)throw Error('Godot loader anchor changed');
const shim='world-engine-loader.js';
const code="(()=>{const nativeFetch=window.fetch.bind(window);const original=new URL('index.wasm',document.baseURI);const asset=new URL("+JSON.stringify(file)+",document.baseURI);window.fetch=async function(input,init){const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,document.baseURI);const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();if(method!=='GET'||url.origin!==original.origin||url.pathname!==original.pathname)return nativeFetch(input,init);if(typeof DecompressionStream!=='function')throw Error('This browser cannot decompress the World engine. Please update your browser.');const response=await nativeFetch(asset,{credentials:'same-origin',signal:init?.signal||(input instanceof Request?input.signal:undefined)});if(!response.ok||!response.body)throw Error('World engine download failed: '+response.status);return new Response(response.body.pipeThrough(new DecompressionStream('gzip')),{status:200,headers:{'Content-Type':'application/wasm','Content-Length':'"+wasm.length+"'}});};})();\n";
writeFileSync(resolve(out,shim),code);
writeFileSync(resolve(out,file),compressed);
writeFileSync(resolve(out,'index.html'),original.replace(anchor,'<script src="'+shim+'?v='+hash.slice(0,16)+'"></script>\n\t\t'+anchor));
for(const p of ['index.js','index.pck','index.png','index.audio.worklet.js','index.audio.position.worklet.js','world-surface.png','favicon-brand.png','favicon-brand.svg'])if(!statSync(resolve(out,p)).isFile())throw Error('Missing runtime asset '+p);
writeFileSync(resolve(out,'engine-manifest.json'),JSON.stringify({file,rawBytes:wasm.length,compressedBytes:compressed.length,sha256:hash}));
console.log('World engine: '+wasm.length+' bytes -> '+compressed.length+' bytes. All static assets fit the Pages limit.');
