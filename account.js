/* Supabase Auth + private user collections. Guest storage remains separate. */
(async function () {
  'use strict';
  const config = window.MEMORY_AUTH_CONFIG || {};
  const accountButton = $('#accountButton'), notice = $('#accountNotice'), status = $('#storageStatus');
  let client = null, user = null, ready = false, loading = false, busy = false, mode = 'login';
  let generation = 0, recovery = false, versions = { memories: 0, topics: 0 };
  const guestPersist = persist, guestTopics = saveTopics;
  function message(text) { notice.textContent = text; }
  function showPanels() {
    $('#signedOutPanel').classList.toggle('hidden', !!user || recovery);
    $('#signedInPanel').classList.toggle('hidden', !user || recovery);
    $('#newPasswordForm').classList.toggle('hidden', !recovery);
    $('#accountHeading').textContent = recovery ? '设置新密码' : user ? '我的账号' : '登录记忆书店';
    accountButton.textContent = user ? '我的账号' : '登录 / 注册';
    status.textContent = user ? (ready ? '已登录 · 记录保存在您的私人云端书架' : '正在读取账号记录，请稍候……') : '游客模式 · 记录仅保存在当前浏览器';
  }
  function localRecords(key) { try { const items = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(items) ? items : []; } catch { return []; } }
  function clearForms() {
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    ['#memoryForm','#topicForm','#replyForm','#profileForm'].forEach(s => $(s).reset());
    editing = null; activeTopic = null; photoData = ''; audioData = '';
    $('#audioPreview').removeAttribute('src');
    $('#audioPreview').classList.add('hidden');
    $('#replies').textContent = ''; $('#topicReadTitle').textContent = ''; $('#topicReadBody').textContent = '';
  }
  async function loadCollections() {
    if (!user) return;
    const id = user.id, revision = generation;
    loading = true; ready = false; showPanels();
    try {
      const [collections, profile] = await Promise.all([
        client.from('memory_collections').select('kind,data,version').eq('user_id', id),
        client.from('memory_profiles').select('nickname,hometown,bio').eq('user_id', id).maybeSingle()
      ]);
      if (collections.error || profile.error) throw collections.error || profile.error;
      if (generation !== revision) return;
      const rows = collections.data || [];
      const a = rows.find(r => r.kind === 'memories'), b = rows.find(r => r.kind === 'topics');
      if ((a && !Array.isArray(a.data)) || (b && !Array.isArray(b.data))) throw Error('INVALID_DATA');
      memories = a?.data || []; topics = b?.data || [];
      versions = { memories: a?.version || 0, topics: b?.version || 0 };
      $('#profileNickname').value = profile.data?.nickname || '';
      $('#profileHometown').value = profile.data?.hometown || '';
      $('#profileBio').value = profile.data?.bio || '';
      $('#accountEmailDisplay').textContent = user.email || '';
      ready = true; render(); renderStories(currentCategory, currentSub);
      message('账号记录已读取。每次保存成功后才会更新书架。');
    } catch {
      message('云端记录读取失败。请确认网络连接，并已执行数据库初始化 SQL。可点击“重新读取云端记录”重试。');
      status.textContent = '云端连接失败 · 暂停保存，请在账号中重试';
      toast('云端记录未能读取，已暂停保存，避免覆盖已有内容。');
    } finally { if (generation === revision) { loading = false; showPanels(); if (!ready) status.textContent = '云端连接失败 · 暂停保存，请在账号中重试'; } }
  }
  async function applySession(session, force = false) {
    const incoming = session?.user || null;
    if (!force && incoming?.id === user?.id && (ready || loading)) return;
    generation++; user = incoming; ready = false;
    clearForms(); memories = []; topics = []; versions = { memories: 0, topics: 0 };
    render(); renderStories(currentCategory, currentSub); showPanels();
    if (user) await loadCollections();
    else {
      loading = false; memories = localRecords(STORE); topics = localRecords(TOPIC_STORE);
      render(); renderStories(currentCategory, currentSub); showPanels();
      message('已退出账号。当前显示此浏览器中的游客记录。');
    }
  }
  async function cloudSave(kind, data) {
    if (loading || busy || (user && !ready)) { toast('正在处理账号数据，请稍后重试。'); return false; }
    if (!user) return kind === 'memories' ? guestPersist(data) : guestTopics(data);
    busy = true; status.textContent = '正在保存到您的账号……';
    const revision = generation;
    try {
      const { data: version, error } = await client.rpc('save_memory_collection', {
        p_kind: kind, p_data: data, p_expected_version: versions[kind]
      });
      if (error) throw error;
      if (revision !== generation) return false;
      versions[kind] = version;
      if (kind === 'memories') { memories = data; render(); } else topics = data;
      status.textContent = '已保存到您的私人云端书架'; return true;
    } catch (error) {
      const conflict = String(error.message).includes('VERSION_CONFLICT');
      status.textContent = '本次保存未成功 · 内容尚未更新';
      toast(conflict ? '其他设备已更新记录。请先复制当前文字，再在账号中重新读取云端记录。' : '云端保存失败，内容尚未更新。请检查网络后重试。');
      return false;
    } finally { busy = false; }
  }
  persist = next => cloudSave('memories', next);
  saveTopics = next => cloudSave('topics', next);
  accountButton.onclick = () => { $('#accountDialog').showModal(); };
  function setMode(next) {
    mode = next; $('#accountForm').reset();
    $('#accountPassword').autocomplete = next === 'signup' ? 'new-password' : 'current-password';
    $('#accountConfirm').required = next === 'signup';
    ['#confirmLabel','#accountConfirm'].forEach(s => $(s).classList.toggle('hidden', next !== 'signup'));
    $('#accountSubmit').textContent = next === 'signup' ? '注册账号' : '登录';
    for (const [selector, value] of [['#loginTab','login'],['#signupTab','signup']]) {
      $(selector).classList.toggle('active', value === next); $(selector).setAttribute('aria-pressed', String(value === next));
    }
  }
  $('#loginTab').onclick = () => setMode('login'); $('#signupTab').onclick = () => setMode('signup');
  $('#showPassword').onclick = () => {
    const reveal = $('#accountPassword').type === 'password';
    $('#accountPassword').type = reveal ? 'text' : 'password'; $('#accountConfirm').type = reveal ? 'text' : 'password';
    $('#showPassword').textContent = reveal ? '隐藏密码' : '显示密码'; $('#showPassword').setAttribute('aria-pressed', String(reveal));
  };
  $('#accountDialog').addEventListener('close', () => {
    $('#accountPassword').value = ''; $('#accountConfirm').value = ''; $('#newPassword').value = '';
    $('#accountPassword').type = 'password'; $('#accountConfirm').type = 'password';
    $('#showPassword').textContent = '显示密码'; $('#showPassword').setAttribute('aria-pressed','false');
  });
  function authError(error) {
    if (/invalid login/i.test(error.message)) return '邮箱或密码不正确，请重新输入。';
    if (/email not confirmed/i.test(error.message)) return '请先打开邮箱中的确认邮件，验证后再登录。';
    if (/rate|too many/i.test(error.message)) return '操作次数较多，请稍后再试。';
    if (/password/i.test(error.message)) return '密码不符合要求，请使用至少 8 个字符的密码。';
    return '操作未完成，请检查网络、邮箱信息和登录服务配置后重试。';
  }
  const redirectTo = location.protocol === 'https:' ? location.origin + location.pathname : undefined;
  $('#accountForm').onsubmit = async e => {
    e.preventDefault(); if (!client || busy || loading) return;
    const email = $('#accountEmail').value.trim(), password = $('#accountPassword').value;
    if (mode === 'signup' && password !== $('#accountConfirm').value) { message('两次密码不一致，请重新输入。'); return; }
    $('#accountSubmit').disabled = true; message('正在处理，请稍候……');
    try {
      const result = mode === 'signup' ? await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }) : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      $('#accountPassword').value = ''; $('#accountConfirm').value = '';
      if (result.data.session) { await applySession(result.data.session); toast('已登录，正在使用您的账号书架。'); }
      else message('如该邮箱可以注册，您会收到确认邮件。请查看收件箱和垃圾邮件，确认后再登录。');
    } catch (error) { message(authError(error)); }
    finally { $('#accountSubmit').disabled = false; }
  };
  $('#resetPassword').onclick = async () => {
    if (!client) return; const email = $('#accountEmail');
    if (!email.value || !email.reportValidity()) return;
    $('#resetPassword').disabled = true;
    try { const { error } = await client.auth.resetPasswordForEmail(email.value.trim(), { redirectTo }); if (error) throw error; message('如果该邮箱已注册，您将收到重置密码的邮件，请查收。'); }
    catch (error) { message(authError(error)); } finally { $('#resetPassword').disabled = false; }
  };
  $('#newPasswordForm').onsubmit = async e => {
    e.preventDefault(); if (!client) return; const button = e.submitter; button.disabled = true;
    try { const { error } = await client.auth.updateUser({ password: $('#newPassword').value }); if (error) throw error; recovery = false; $('#newPassword').value = ''; showPanels(); message('新密码已保存。'); }
    catch (error) { message(authError(error)); } finally { button.disabled = false; }
  };
  $('#profileForm').onsubmit = async e => {
    e.preventDefault(); if (!user || !ready || busy) return;
    busy = true; const button = e.submitter; button.disabled = true;
    try {
      const { error } = await client.from('memory_profiles').upsert({ user_id: user.id, nickname: $('#profileNickname').value.trim(), hometown: $('#profileHometown').value.trim(), bio: $('#profileBio').value.trim() });
      if (error) throw error; message('个人资料已保存到您的账号。');
    } catch { message('个人资料未保存，请检查网络后重试。'); }
    finally { busy = false; button.disabled = false; }
  };
  $('#reloadCloud').onclick = () => { if (!busy && !loading && confirm('重新读取会关闭当前编辑窗口。请先复制尚未保存的文字，是否继续？')) { clearForms(); $('#accountDialog').showModal(); loadCollections(); } };
  $('#importGuest').onclick = async () => {
    if (!user || !ready || busy) return;
    if (!confirm('把此浏览器中的游客回忆和话题复制到当前账号？原游客记录将保留。')) return;
    const guestMemories = localRecords(STORE), guestDiscussion = localRecords(TOPIC_STORE);
    const merge = (a,b) => { const ids = new Set(a.map(x=>x.id)); return [...a,...b.filter(x=>!ids.has(x.id))]; };
    if (!await persist(merge(memories, guestMemories))) return;
    if (!await saveTopics(merge(topics, guestDiscussion))) { message('回忆已导入，但话题未保存，请稍后重试。'); return; }
    renderStories(currentCategory,currentSub); message('游客记录已复制到您的账号，原记录仍保留在此设备。');
  };
  $('#signOut').onclick = async () => {
    if (!client || busy || loading) return;
    if (!confirm('确定退出账号？请先保存或复制尚未完成的文字。')) return;
    try { const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error; await applySession(null, true); toast('已退出账号。'); }
    catch { message('退出未完成，请检查网络后重试。'); }
  };
  if (!config.url || !config.publicKey) { message('账号服务尚未启用。当前可继续以游客身份使用，记录只保存在此浏览器。'); showPanels(); return; }
  try {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url)) throw Error('INVALID_CONFIG');
    if (config.publicKey.startsWith('sb_secret_')) throw Error('PRIVATE_KEY');
    if (config.publicKey.startsWith('eyJ')) { const payload = JSON.parse(atob(config.publicKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); if (payload.role !== 'anon') throw Error('PRIVATE_KEY'); }
    loading = true;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    client = createClient(config.url, config.publicKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: sessionStorage, storageKey: 'memory-bookstore-auth' } });
    loading = true;
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') recovery = true;
      if (['SIGNED_IN','SIGNED_OUT','PASSWORD_RECOVERY'].includes(event)) setTimeout(async () => { await applySession(session); if (recovery) { showPanels(); if (!$('#accountDialog').open) $('#accountDialog').showModal(); } },0);
    });
    const { data, error } = await client.auth.getSession(); if (error) throw error;
    await applySession(data.session, true); loading = false;
    $('#accountSubmit').disabled = false; $('#resetPassword').disabled = false;
    if (!user) message('用邮箱登录或注册，登录后可跨设备读取您的记录。');
  } catch { loading = false; message('账号服务暂不可用，请检查配置和网络。游客功能仍可使用。'); showPanels(); }
})();
