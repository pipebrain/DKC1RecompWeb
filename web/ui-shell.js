// Native-inspired app chrome, implemented with browser APIs only.
export function initAppShell({
  onCommand=()=>{}, onBeforeOpenSettings=async()=>true,
  onBeforeCloseSettings=async()=>true, onMenuOpen=()=>{}, getState=()=>({}),
}={}) {
  const settings=document.getElementById('app-settings');
  const about=document.getElementById('about-dialog');
  const help=document.getElementById('help-dialog');
  const triggers=[...document.querySelectorAll('.menu-trigger[aria-controls]')];
  const tabs=[...document.querySelectorAll('[data-settings-tab]')].filter(tab=>!tab.disabled);
  const inputSections=new Set(['controllers','devices','options']);
  const inputPage=document.getElementById('input-settings-page');
  const inputPageButton=document.getElementById('settings-page-input');
  const panes=[...document.querySelectorAll('[data-settings-pane]')];
  let openTrigger=null,activeTab='controllers',settingsBusy=false,settingsOpener=null,aboutOpener=null,helpOpener=null,pendingStatus=false;
  const enabledItems=menu=>[...menu.querySelectorAll('[role^="menuitem"]')].filter(item=>!item.disabled);
  const visibleTriggers=()=>triggers.filter(item=>item.getClientRects().length);
  function revealInMenu(item) {
    const menu=item?.closest('.app-menu');
    if(!menu)return;
    const rect=item.getBoundingClientRect(),bounds=menu.getBoundingClientRect();
    if(rect.top<bounds.top+6)menu.scrollTop-=bounds.top+6-rect.top;
    else if(rect.bottom>bounds.bottom-6)menu.scrollTop+=rect.bottom-bounds.bottom+6;
  }
  function focusMenuItem(item) {
    if(!item)return;
    item.focus({preventScroll:true});revealInMenu(item);
  }
  function syncNotices() {
    for(const copy of document.querySelectorAll('[data-status-copy]')){
      const source=document.getElementById(copy.dataset.statusCopy);
      copy.textContent=source.textContent;copy.classList.toggle('error',source.classList.contains('error'));
    }
  }
  function report(error) {
    const status=document.getElementById('status');
    status.textContent=error.message||String(error);status.classList.add('error');
    showStatus();
  }
  function dispatch(command) {
    try{Promise.resolve(onCommand(command)).catch(report);}catch(error){report(error);}
  }
  function closeMenus(restore=false) {
    const prior=openTrigger;
    for(const trigger of triggers){document.getElementById(trigger.getAttribute('aria-controls')).hidden=true;trigger.setAttribute('aria-expanded','false');}
    openTrigger=null;
    if(restore)prior?.focus({preventScroll:true});
  }
  function positionMenu(trigger,menu) {
    const rect=trigger.getBoundingClientRect();
    menu.style.maxHeight=`${Math.max(44,innerHeight-rect.bottom-12)}px`;
    menu.style.left='0px';menu.style.top=`${rect.bottom+4}px`;
    const bounds=menu.getBoundingClientRect();
    const left=Math.max(8,Math.min(rect.left,innerWidth-bounds.width-8));
    const top=Math.max(4,Math.min(rect.bottom+4,innerHeight-bounds.height-8));
    menu.style.left=`${left}px`;menu.style.top=`${top}px`;
  }
  function showMenu(trigger,focus='none') {
    if(document.querySelector('dialog[open]'))return;
    onMenuOpen();
    syncNotices();
    closeMenus();
    const menu=document.getElementById(trigger.getAttribute('aria-controls'));
    menu.hidden=false;menu.scrollTop=0;trigger.setAttribute('aria-expanded','true');openTrigger=trigger;
    positionMenu(trigger,menu);
    const items=enabledItems(menu);
    if(focus==='none')trigger.focus({preventScroll:true});
    if(focus==='first')focusMenuItem(items[0]||trigger);
    if(focus==='last')focusMenuItem(items.at(-1)||trigger);
  }
  for(const trigger of triggers){
    trigger.addEventListener('click',()=>{if(openTrigger===trigger)closeMenus();else showMenu(trigger);});
    trigger.addEventListener('pointerenter',()=>{if(openTrigger&&openTrigger!==trigger)showMenu(trigger);});
    trigger.addEventListener('keydown',event=>{
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();showMenu(trigger,event.key==='ArrowDown'?'first':'last');}
      else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
        event.preventDefault();const siblings=visibleTriggers();
        const next=siblings[(siblings.indexOf(trigger)+(event.key==='ArrowRight'?1:-1)+siblings.length)%siblings.length];
        next?.focus();if(openTrigger)showMenu(next,'first');
      }else if(event.key==='Escape'){event.preventDefault();closeMenus(true);}
    });
  }
  document.addEventListener('pointerdown',event=>{if(openTrigger&&!event.target.closest('.menu-group')&&!event.target.closest('.app-menu'))closeMenus();});
  document.addEventListener('keydown',event=>{
    if(!openTrigger)return;
    const menu=document.getElementById(openTrigger.getAttribute('aria-controls'));
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenus(true);return;}
    if(event.key==='Tab'){closeMenus();return;}
    if(!menu.contains(event.target))return;
    const items=enabledItems(menu),index=items.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
      focusMenuItem(items[next]);
    }else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();const siblings=visibleTriggers();
      const next=siblings[(siblings.indexOf(openTrigger)+(event.key==='ArrowRight'?1:-1)+siblings.length)%siblings.length];
      showMenu(next,'first');
    }
  });
  for(const button of document.querySelectorAll('[data-command]'))button.addEventListener('click',()=>{
    if(button.disabled)return;
    const command=button.dataset.command,prior=openTrigger;closeMenus();prior?.focus({preventScroll:true});
    dispatch(command);
  });
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.isComposing||event.altKey)return;
    const editable=event.target.closest?.('input,select,textarea,[contenteditable="true"]');
    const modal=Boolean(document.querySelector('dialog[open]'));
    const key=event.key.toLowerCase(),modifier=(event.metaKey||event.ctrlKey)&&!event.shiftKey;
    if(modifier&&['o',','].includes(key)&&(modal||editable)){event.preventDefault();return;}
    let command=null;
    if(modifier&&key===','&&!modal&&!editable)command='settings';
    else if(modifier&&key==='o'&&!modal&&!editable)command='open-rom';
    else if(event.metaKey&&event.ctrlKey&&!event.shiftKey&&key==='f'&&!modal&&!editable&&getState().fullscreenAvailable)command='fullscreen';
    else if(event.code==='Space'&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!modal&&event.target===document.getElementById('screen')&&getState().loaded&&!getState().spaceIsStart&&(!getState().spaceBound||!getState().running))command='toggle';
    if(!command)return;
    event.preventDefault();closeMenus();
    dispatch(command);
  });
  function selectTab(tab) {
    activeTab=tab;
    const inputSelected=inputSections.has(tab);
    inputPage.hidden=!inputSelected;
    inputPageButton.setAttribute('aria-selected',String(inputSelected));
    inputPageButton.tabIndex=inputSelected?0:-1;
    for(const button of tabs){const selected=button.dataset.settingsTab===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
    for(const pane of panes)pane.hidden=pane.dataset.settingsPane!==tab;
    settings.querySelector('.settings-content').scrollTop=0;
    settings.dataset.section=tab;
    settings.dataset.page=inputSelected?'input':tab;
  }
  function revealSettingsTab(tab) {
    const selected=tabs.find(item=>item.dataset.settingsTab===tab);
    for(const target of inputSections.has(tab)?[inputPageButton,selected]:[selected]){
      const navigation=target?.parentElement;
      if(!target||!navigation)continue;
      const rect=target.getBoundingClientRect(),bounds=navigation.getBoundingClientRect();
      if(rect.left<bounds.left)navigation.scrollLeft-=bounds.left-rect.left;
      else if(rect.right>bounds.right)navigation.scrollLeft+=rect.right-bounds.right;
      if(rect.top<bounds.top)navigation.scrollTop-=bounds.top-rect.top;
      else if(rect.bottom>bounds.bottom)navigation.scrollTop+=rect.bottom-bounds.bottom;
    }
  }
  async function openSettings(tab='controllers') {
    if(!tabs.some(button=>button.dataset.settingsTab===tab))throw new Error('Unknown settings section.');
    closeMenus();
    if(settings.open&&activeTab===tab)return true;
    if(settingsBusy)return false;
    settingsBusy=true;
    try{
      if(await onBeforeOpenSettings(tab)===false)return false;
      const wasOpen=settings.open;
      if(!wasOpen)settingsOpener=document.activeElement;
      selectTab(tab);
      if(!wasOpen)settings.showModal();
      revealSettingsTab(tab);
      const pane=panes.find(item=>item.dataset.settingsPane===tab);
      const target=pane.querySelector('select:not(:disabled), input:not(:disabled):not([hidden]), button:not(:disabled):not([hidden])');
      (target||tabs.find(item=>item.dataset.settingsTab===tab)).focus({preventScroll:true});
      return true;
    }finally{settingsBusy=false;}
  }
  async function closeSettings() {
    if(!settings.open)return true;
    if(settingsBusy)return false;
    settingsBusy=true;
    try{
      if(await onBeforeCloseSettings()===false)return false;
      settings.close();return true;
    }finally{settingsBusy=false;}
  }
  const navigationButtons=[...tabs,inputPageButton];
  const sectionFor=button=>button.dataset.settingsPage==='input'?'controllers':button.dataset.settingsTab;
  for(const tab of navigationButtons){
    tab.addEventListener('click',()=>openSettings(sectionFor(tab)).catch(report));
    tab.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      event.preventDefault();
      const siblings=[...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')].filter(item=>!item.disabled);
      const index=siblings.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?siblings.length-1:(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+siblings.length)%siblings.length;
      openSettings(sectionFor(siblings[next])).then(allowed=>{if(allowed)siblings[next].focus({preventScroll:true});}).catch(report);
    });
  }
  document.getElementById('settings-done').addEventListener('click',()=>closeSettings().catch(report));
  settings.addEventListener('cancel',event=>{event.preventDefault();closeSettings().catch(report);});
  settings.addEventListener('click',event=>{if(event.target!==settings)return;const rect=settings.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeSettings().catch(report);});
  settings.addEventListener('close',()=>{if(settingsOpener?.isConnected)settingsOpener.focus({preventScroll:true});if(pendingStatus)showStatus();});
  function openHelp() {
    closeMenus();
    if(help.open)return;
    helpOpener=document.activeElement;
    help.showModal();
    help.querySelector('[data-close-help]').focus({preventScroll:true});
  }
  for(const button of help.querySelectorAll('[data-close-help]'))button.addEventListener('click',()=>help.close());
  help.addEventListener('close',()=>{if(helpOpener?.isConnected)helpOpener.focus({preventScroll:true});if(pendingStatus)showStatus();});
  help.addEventListener('click',event=>{if(event.target!==help)return;const rect=help.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)help.close();});
  for(const button of document.querySelectorAll('[data-close-about]'))button.addEventListener('click',()=>about.close());
  about.addEventListener('beforetoggle',event=>{if(event.newState==='open'&&!about.contains(document.activeElement))aboutOpener=document.activeElement;});
  about.addEventListener('close',()=>{if(aboutOpener?.isConnected)aboutOpener.focus({preventScroll:true});if(pendingStatus)showStatus();});
  about.addEventListener('click',event=>{if(event.target!==about)return;const rect=about.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)about.close();});
  window.addEventListener('resize',()=>{if(openTrigger){if(!openTrigger.getClientRects().length)closeMenus();else positionMenu(openTrigger,document.getElementById(openTrigger.getAttribute('aria-controls')));}});
  function changeLabel(button,label) {
    const node=[...button.childNodes].find(child=>child.nodeType===Node.TEXT_NODE);
    if(node)node.textContent=label;else button.prepend(document.createTextNode(label));
  }
  function showStatus() {
    if(document.querySelector('dialog[open]')){pendingStatus=true;return;}
    pendingStatus=false;
    const target=visibleTriggers().find(trigger=>trigger.getAttribute('aria-controls')==='menu-dkm')||visibleTriggers()[0];
    if(!target)return;
    showMenu(target);target.focus({preventScroll:true});
    const menu=document.getElementById(target.getAttribute('aria-controls'));
    revealInMenu(menu.querySelector('.menu-notices'));
  }
  function update(value=getState()) {
    const {loaded=false,running=false,hasStarted=false,sound=true,loading=false,playbackBusy=false,playbackError=false,pausedReason,helpAvailable=false,aboutAvailable=false,inputMode='keyboard',keyboardCustom=false}=value;
    document.body.dataset.running=String(running);document.body.dataset.loaded=String(loaded);document.body.dataset.sound=String(sound);
    for(const button of document.querySelectorAll('[data-needs-game]'))button.disabled=!loaded||loading;
    for(const button of document.querySelectorAll('[data-start-game]')){
      changeLabel(button,running?'Pause Game':hasStarted?'Resume Game':'Start Game');
      button.disabled=!loaded||loading||playbackBusy||playbackError||['error','gpu-error'].includes(pausedReason);
    }
    for(const button of document.querySelectorAll('[data-command="open-rom"]'))button.disabled=loading;
    for(const button of document.querySelectorAll('[data-command="keyboard"]')){button.disabled=!helpAvailable;button.title=helpAvailable?'':'Help is unavailable.';}
    for(const button of document.querySelectorAll('[data-command="about"]')){button.disabled=!aboutAvailable;button.title=aboutAvailable?'':'About is unavailable.';}
    const inputLabel=inputMode==='keyboard'?(keyboardCustom?'Keyboard (custom)':'Keyboard (default)'):'Gamepad';
    for(const label of document.querySelectorAll('[data-input-label]'))label.textContent=inputLabel;
    document.querySelector('#input-source option[value="keyboard"]').textContent=keyboardCustom?'Keyboard (custom)':'Keyboard (default)';
    for(const button of document.querySelectorAll('[data-toggle-label]')){
      changeLabel(button,running?'Pause':hasStarted?'Resume':'Start');
      button.disabled=!loaded||loading||playbackBusy||playbackError||['error','gpu-error'].includes(pausedReason);
    }
    for(const button of document.querySelectorAll('[data-command="audio"]')){
      if(button.getAttribute('role')==='menuitemcheckbox')button.setAttribute('aria-checked',String(sound));
      else button.setAttribute('aria-pressed',String(sound));
      if(button.hasAttribute('data-sound-label'))changeLabel(button,sound?'Sound On':'Sound Off');
    }
    const fullscreenAvailable=Boolean(value.fullscreenAvailable);
    for(const button of document.querySelectorAll('[data-fullscreen-label]')){
      changeLabel(button,document.fullscreenElement?'Exit Full Screen':'Enter Full Screen');
      button.disabled=!fullscreenAvailable;
      button.title=fullscreenAvailable?'':'Full screen is not available in this browser.';
    }
    syncNotices();
  }
  document.addEventListener('fullscreenchange',()=>update(getState()));
  selectTab('controllers');update(getState());
  const noticeObserver=new MutationObserver(syncNotices);
  for(const id of ['status','save-status'])noticeObserver.observe(document.getElementById(id),{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class']});
  return {update,openSettings,closeSettings,openHelp,isSettingsOpen:()=>settings.open,isMenuOpen:()=>Boolean(openTrigger),isSettingsBusy:()=>settingsBusy,activeSettingsTab:()=>activeTab,closeMenus,showStatus};
}
