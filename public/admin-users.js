window.renderAdminUsers = function(container, users, {api, reload, currentUser, companies, notify}) {
  container.replaceChildren();
  if (!users.length) { container.textContent='Todavía no creaste usuarios de empresas.'; return; }
  for (const user of users) {
    const row=document.createElement('div'); row.className='data-row';
    const main=document.createElement('div'); main.className='data-row-main';
    const title=document.createElement('strong'); title.textContent=user.display_name||user.login_key;
    const detail=document.createElement('small'); detail.textContent=`${user.login_key} · ${user.role} · ${user.active?'Activo':'Suspendido'}`;
    main.append(title,detail);row.append(main);container.append(row);
    const isSuperadmin=String(user.role).toUpperCase()==='SUPERADMIN';
    const ownAccount=Number(user.user_id)===Number(currentUser.userId);
    // Membership controls are never meaningful for a global SUPERADMIN.
    // Account lifecycle controls are different: another superadmin can manage
    // this account only while an active peer remains to prevent lockout.
    const protectedUser=isSuperadmin||ownAccount;
    const hasOtherActiveSuperadmin=users.some(other=>
      Number(other.user_id)!==Number(user.user_id)&&
      String(other.role).toUpperCase()==='SUPERADMIN'&&other.active===true
    );
    const canDelete=!ownAccount&&(!isSuperadmin||hasOtherActiveSuperadmin);
    const canToggle=!ownAccount&&(!isSuperadmin||!user.active||hasOtherActiveSuperadmin);
    function button(label, question, url, options) {
      const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;
      b.addEventListener('click',async()=>{
        if(!window.confirm(question))return;
        b.disabled=true;
        try { await api(url,options);await reload();notify('Acceso actualizado.'); }
        catch(e) { notify(e.message||'No se pudo actualizar el acceso.');b.disabled=false; }
      });return b;
    }
    for(const membership of user.companies||[]) {
      const entry=document.createElement('div');entry.style.cssText='display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px';
      const name=companies.find(c=>c.idEmpresa===membership.companyId)?.nombreEmpresa||membership.companyId;
      const label=document.createElement('span');label.textContent=name;entry.append(label);
      if(!protectedUser)entry.append(button('Quitar acceso a empresa',`¿Quitar a ${user.login_key} el acceso a ${name}? Sus sesiones perderán acceso en la próxima solicitud. Se conservan los datos del negocio y el acceso a otras empresas.`,
        `/api/admin/users/${encodeURIComponent(user.user_id)}/companies/${encodeURIComponent(membership.companyId)}`,{method:'DELETE'}));
      main.append(entry);
    }
    if(!(user.companies||[]).length){const label=document.createElement('small');label.textContent=protectedUser?'Acceso global de superadministrador':'Sin empresas asignadas';main.append(label);}
    if(!protectedUser){
      const available=companies.filter(c=>!(user.companies||[]).some(m=>m.companyId===c.idEmpresa));
      if(available.length){
        const select=document.createElement('select');select.setAttribute('aria-label','Empresa para restablecer acceso');
        for(const company of available){const option=document.createElement('option');option.value=company.idEmpresa;option.textContent=company.nombreEmpresa;select.append(option);}
        const restore=document.createElement('button');restore.type='button';restore.className='btn';restore.textContent='Restablecer / asignar acceso';
        restore.addEventListener('click',async()=>{
          const id=select.value;
          if(!confirm(`¿Asignar a ${user.login_key} acceso a ${select.selectedOptions[0].textContent} con los permisos predeterminados?${user.active?'':' El usuario está suspendido: deberás reactivarlo para que ingrese.'}`))return;
          restore.disabled=true;
          try{await api(`/api/admin/users/${encodeURIComponent(user.user_id)}/companies/${encodeURIComponent(id)}`,{method:'POST'});await reload();notify('Acceso asignado.');}
          catch(e){notify(e.message);restore.disabled=false;}
        });
        const assign=document.createElement('div');assign.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-top:12px';assign.append(select,restore);main.append(assign);
      }
    }
    if(canDelete){
      const deletion=button('Eliminar usuario',`¿Eliminar definitivamente al usuario ${user.login_key}? Se borrará su cuenta y todos sus accesos. Se conservan las empresas, pedidos y reservas. Esta acción no se puede deshacer.`,
        `/api/admin/users/${encodeURIComponent(user.user_id)}`,{method:'DELETE'});
      deletion.style.marginTop='12px';main.append(deletion);
    }
    // SUPERADMIN can reset other users, including another SUPERADMIN.
    // Never display or return the existing password; the new value is sent
    // exclusively to the authenticated reset endpoint in a JSON body.
    if(!ownAccount){
      const open=document.createElement('button');
      open.type='button';open.className='btn';open.textContent='Restablecer contraseña';
      open.setAttribute('aria-expanded','false');
      const form=document.createElement('form');form.hidden=true;
      form.style.cssText='margin-top:12px;display:grid;gap:8px;max-width:460px';
      const heading=document.createElement('small');
      heading.textContent='Contraseña nueva (mínimo 12 caracteres). Se cerrarán las sesiones anteriores.';
      const password=document.createElement('input');
      password.type='password';password.required=true;password.minLength=12;
      password.autocomplete='new-password';password.placeholder='Nueva contraseña';
      password.setAttribute('aria-label','Nueva contraseña de '+user.login_key);
      const confirmPassword=document.createElement('input');
      confirmPassword.type='password';confirmPassword.required=true;confirmPassword.minLength=12;
      confirmPassword.autocomplete='new-password';confirmPassword.placeholder='Repetir contraseña';
      confirmPassword.setAttribute('aria-label','Confirmar contraseña de '+user.login_key);
      const save=document.createElement('button');save.type='submit';save.className='btn btn-primary';
      save.textContent='Guardar contraseña nueva';
      const status=document.createElement('small');status.setAttribute('role','status');
      status.setAttribute('aria-live','polite');
      form.append(heading,password,confirmPassword,save,status);
      open.addEventListener('click',()=>{
        form.hidden=!form.hidden;
        open.setAttribute('aria-expanded',String(!form.hidden));
        if(form.hidden){password.value='';confirmPassword.value='';status.textContent='';}
        else password.focus();
      });
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        status.textContent='';
        if(password.value.length<12){status.textContent='Ingresá al menos 12 caracteres.';password.focus();return;}
        if(password.value!==confirmPassword.value){status.textContent='Las contraseñas no coinciden.';confirmPassword.focus();return;}
        if(!window.confirm('¿Cambiar la contraseña de '+user.login_key+'? Todas sus sesiones anteriores se cerrarán.'))return;
        save.disabled=true;
        try{
          await api('/api/admin/users/'+encodeURIComponent(user.user_id)+'/password',{
            method:'POST',
            body:JSON.stringify({newPassword:password.value})
          });
          password.value='';confirmPassword.value='';
          form.hidden=true;open.setAttribute('aria-expanded','false');
          notify('Contraseña restablecida para '+user.login_key+'. Las sesiones anteriores fueron invalidadas.');
        }catch(err){
          status.textContent=err.message||'No se pudo restablecer la contraseña.';
        }finally{save.disabled=false;}
      });
      open.style.marginTop='12px';
      main.append(open,form);
    }
    if(canToggle){
      const controls=document.createElement('div');controls.style.cssText='margin-top:12px;display:flex;flex-wrap:wrap;gap:8px';
      controls.append(button(user.active?'Suspender usuario':'Reactivar usuario',user.active?`¿Suspender a ${user.login_key}? No podrá ingresar a ninguna empresa y sus sesiones serán rechazadas en la próxima solicitud. Se conservan los datos.`:`¿Reactivar a ${user.login_key}? Recuperará acceso a las empresas que todavía tenga asignadas.`,
        `/api/admin/users/${encodeURIComponent(user.user_id)}/active`,{method:'POST',body:JSON.stringify({active:!user.active})}));main.append(controls);
    }
  }
};
