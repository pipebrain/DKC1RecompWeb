// Small Markdown reader for the application's own editable About/Help files.
// Content is always added as DOM text; raw HTML and executable links are not parsed.
const MAX_DOCUMENT_LENGTH=65536;

function safeLink(value){
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:null;}
  catch{return null;}
}

function appendInline(parent,value){
  const document=parent.ownerDocument;
  const tokens=/`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let offset=0,match;
  while((match=tokens.exec(value))){
    if(match.index>offset)parent.append(document.createTextNode(value.slice(offset,match.index)));
    let element;
    if(match[1]!==undefined){element=document.createElement('code');element.textContent=match[1];}
    else if(match[2]!==undefined){
      const href=safeLink(match[3]);
      if(href){element=document.createElement('a');element.textContent=match[2];element.href=href;element.target='_blank';element.rel='noopener noreferrer';}
      else element=document.createTextNode(match[0]);
    }else{element=document.createElement(match[4]!==undefined?'strong':'em');element.textContent=match[4]??match[5];}
    parent.append(element);offset=tokens.lastIndex;
  }
  if(offset<value.length)parent.append(document.createTextNode(value.slice(offset)));
}

function tableCells(line){
  let value=line.trim();
  if(value.startsWith('|'))value=value.slice(1);
  if(value.endsWith('|')&&!value.endsWith('\\|'))value=value.slice(0,-1);
  const cells=[];let cell='';
  for(let i=0;i<value.length;i++){
    if(value[i]==='\\'&&value[i+1]==='|'){cell+='|';i++;}
    else if(value[i]==='|'){cells.push(cell.trim());cell='';}
    else cell+=value[i];
  }
  cells.push(cell.trim());return cells;
}
const listItem=line=>line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
const heading=line=>line.match(/^(#{1,4})\s+(.+)$/);
const rule=line=>/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
const fence=line=>/^\s*```/.test(line);
function isTable(lines,index){
  if(!lines[index]?.includes('|')||index+1>=lines.length)return false;
  const separators=tableCells(lines[index+1]);
  return separators.length>1&&separators.every(cell=>/^:?-{3,}:?$/.test(cell));
}
function startsBlock(lines,index){return !lines[index].trim()||heading(lines[index])||listItem(lines[index])||rule(lines[index])||fence(lines[index])||isTable(lines,index);}

export function renderMarkdown(markdown,element){
  if(typeof markdown!=='string'||markdown.length>MAX_DOCUMENT_LENGTH)throw new Error('The document is too large or is not text.');
  if(!element?.ownerDocument||typeof element.replaceChildren!=='function')throw new TypeError('A document container is required.');
  const document=element.ownerDocument,fragment=document.createDocumentFragment();
  const lines=markdown.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
  let index=0;
  while(index<lines.length){
    const line=lines[index];
    if(!line.trim()){index++;continue;}
    const title=heading(line);
    if(title){const node=document.createElement(`h${title[1].length}`);appendInline(node,title[2]);fragment.append(node);index++;continue;}
    if(fence(line)){
      const content=[];index++;
      while(index<lines.length&&!fence(lines[index]))content.push(lines[index++]);
      if(index<lines.length)index++;
      const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=content.join('\n');pre.append(code);fragment.append(pre);continue;
    }
    if(rule(line)){fragment.append(document.createElement('hr'));index++;continue;}
    if(isTable(lines,index)){
      const table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody');
      const headers=tableCells(line),headerRow=document.createElement('tr');
      for(const cell of headers){const node=document.createElement('th');node.scope='col';appendInline(node,cell);headerRow.append(node);}
      head.append(headerRow);index+=2;
      while(index<lines.length&&lines[index].trim()&&lines[index].includes('|')){
        const cells=tableCells(lines[index++]),row=document.createElement('tr');
        for(let column=0;column<headers.length;column++){const node=document.createElement('td');appendInline(node,cells[column]||'');row.append(node);}
        body.append(row);
      }
      table.append(head,body);fragment.append(table);continue;
    }
    const item=listItem(line);
    if(item){
      const ordered=item[2]!==undefined,list=document.createElement(ordered?'ol':'ul');
      if(ordered&&Number(item[2])!==1)list.start=Number(item[2]);
      while(index<lines.length){
        const next=listItem(lines[index]);if(!next||(next[2]!==undefined)!==ordered)break;
        const node=document.createElement('li');appendInline(node,next[3]);list.append(node);index++;
      }
      fragment.append(list);continue;
    }
    const paragraph=[line.trim()];index++;
    while(index<lines.length&&!startsBlock(lines,index))paragraph.push(lines[index++].trim());
    const node=document.createElement('p');appendInline(node,paragraph.join(' '));fragment.append(node);
  }
  element.replaceChildren(fragment);
}

export function loadContentPages({aboutElement,helpElement,onAvailability=()=>{}}={}){
  const elements={about:aboutElement,help:helpElement};
  for(const element of Object.values(elements))if(!element?.ownerDocument||typeof element.replaceChildren!=='function')throw new TypeError('About and Help containers are required.');
  const availability={about:false,help:false,errors:{}};let generation=0;
  const state=()=>({...availability,errors:{...availability.errors}});
  const notify=()=>onAvailability(state());
  async function load(name,version){
    let markdown=null,error=null;
    try{
      const file=name==='about'?'About.md':'Help.md';
      const response=await fetch(new URL(`./${file}`,import.meta.url),{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)throw new Error(`${file} is unavailable (${response.status}).`);
      markdown=await response.text();
      if(!markdown.replace(/^\uFEFF/,'').trim())throw new Error(`${file} is empty.`);
      if(markdown.length>MAX_DOCUMENT_LENGTH)throw new Error(`${file} is too large.`);
      if(/text\/html/i.test(response.headers.get('content-type')||'')||/^\s*(?:<!doctype\s+html|<html\b)/i.test(markdown))throw new Error(`${file} did not return Markdown.`);
    }catch(cause){error=cause instanceof Error?cause.message:String(cause);}
    if(version!==generation)return;
    if(error){elements[name].replaceChildren();availability[name]=false;availability.errors[name]=error;}
    else{
      try{renderMarkdown(markdown,elements[name]);availability[name]=true;delete availability.errors[name];}
      catch(cause){elements[name].replaceChildren();availability[name]=false;availability.errors[name]=cause instanceof Error?cause.message:String(cause);}
    }
    notify();
  }
  function reload(){
    const version=++generation;availability.about=false;availability.help=false;availability.errors={};notify();
    return Promise.all(['about','help'].map(name=>load(name,version))).then(state);
  }
  const ready=reload();
  return {ready,state,reload};
}
