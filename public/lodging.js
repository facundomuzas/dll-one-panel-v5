let lodgingItems=[],lodgingRevision=null,lodgingSeq=0,lodgingBusy=false,lodgingCanEdit=false,lodgingCanOperate=false,lodgingCanConfigure=false;
function resetLodging(){if(typeof resetLodgingOperations==='function')resetLodgingOperations();lodgingSeq++;lodgingItems=[];lodgingRevision=null;lodgingCanEdit=false;lodgingCanOperate=false;lodgingCanConfigure=false;$('lodgingList').replaceChildren();$('lodgingFields').disabled=true;$('lodgingNew').disabled=true;$('lodgingStatus').textContent='';$('cabinPhotos').value='';for(const id of ['cabinId','cabinName','cabinDescription','cabinRate'])$(id).value='';}
async function loadLodging(){
 resetLodging();const seq=lodgingSeq,id=companyId;
 try{const r=await api(`/api/company/${encodeURIComponent(id)}/lodging`);if(id!==companyId||seq!==lodgingSeq)return;
 lodgingItems=r.items;lodgingRevision=r.revision;lodgingCanEdit=r.canEdit;$('lodgingNew').disabled=!r.canEdit;renderLodging();await loadLodgingOperations();
 }catch(e){if(id===companyId&&seq===lodgingSeq)$('lodgingStatus').textContent=e.message;}
}
function renderLodging(){
 const box=$('lodgingList');box.replaceChildren();
 if(!lodgingItems.length){box.textContent='Todavía no hay cabañas cargadas.';return;}
 for(const x of lodgingItems){const card=document.createElement('article');card.className='card';const title=document.createElement('h3');title.textContent=x.name;card.append(title);
 const desc=document.createElement('p');desc.textContent=`Hasta ${x.capacity} personas · ${x.active?'Visible':'Oculta'} · ${x.photos.length} fotos`;card.append(desc);
 if(x.photos[0]){const img=document.createElement('img');img.src=`data:${x.photos[0].mime};base64,${x.photos[0].base64}`;img.alt=x.name;img.style.cssText='width:100%;height:150px;object-fit:cover;border-radius:12px';card.append(img);}
 const button=document.createElement('button');button.className='btn btn-light';button.textContent='Editar ficha';button.disabled=!lodgingCanEdit;button.onclick=()=>editCabin(x);card.append(button);box.append(card);}
}
function newCabin(){if(lodgingCanEdit)editCabin({id:crypto.randomUUID(),name:'',capacity:2,description:'',rate:'',active:true,photos:[]});}
function editCabin(x){if(!lodgingCanEdit||lodgingBusy)return;for(const [key,id] of [['id','cabinId'],['name','cabinName'],['capacity','cabinCapacity'],['description','cabinDescription'],['rate','cabinRate']])$(id).value=x[key];$('cabinActive').checked=x.active;$('cabinRemovePhotos').checked=false;$('cabinPhotos').value='';$('lodgingFields').disabled=false;editLodgingDetails(x);}
async function saveCabinForm(){
 if(lodgingBusy||!lodgingCanEdit||lodgingRevision===null)return;
 const target=companyId,seq=lodgingSeq,revision=lodgingRevision;lodgingBusy=true;$('lodgingFields').disabled=true;
 try{
 const id=$('cabinId').value;let photos=$('cabinRemovePhotos').checked?[]:cabinDraftPhotos;
 const files=[...$('cabinPhotos').files];if(photos.length+files.length>30||files.some(f=>f.size>409600||!['image/jpeg','image/png'].includes(f.type)))throw Error('La galería admite hasta 30 fotos JPG o PNG de 400 KB cada una.');
 if(files.length)photos=photos.concat(await Promise.all(files.map(f=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({mime:f.type,base64:r.result.split(',')[1]});r.onerror=()=>reject(Error('No se pudo leer la foto.'));r.readAsDataURL(f);})))); 
 if(target!==companyId||seq!==lodgingSeq)return;
 const item={id,name:$('cabinName').value.trim(),capacity:Number($('cabinCapacity').value),description:$('cabinDescription').value.trim(),rate:$('cabinRate').value.trim(),active:$('cabinActive').checked,photos,details:readLodgingDetails()};
 const items=lodgingItems.some(x=>x.id===id)?lodgingItems.map(x=>x.id===id?item:x):[...lodgingItems,item];
 const r=await api(`/api/company/${encodeURIComponent(target)}/lodging`,{method:'POST',body:JSON.stringify({items,revision})});
 if(target!==companyId||seq!==lodgingSeq)return;lodgingItems=items;lodgingRevision=r.revision;cabinDraftPhotos=photos;$('cabinPhotos').value='';$('cabinRemovePhotos').checked=false;renderCabinGallery();renderLodging();renderLodgingOperations();$('lodgingStatus').textContent='Cabaña guardada. Las consultas usarán esta ficha.';
 }catch(e){if(target===companyId&&seq===lodgingSeq)$('lodgingStatus').textContent=e.message;}
 finally{lodgingBusy=false;if(target===companyId&&seq===lodgingSeq)$('lodgingFields').disabled=!lodgingCanEdit;}
}
