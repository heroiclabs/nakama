'use strict';

const { page } = require('./layout');

const CSS = `
  .converter-grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  .drop { border:2px dashed var(--border); border-radius:12px; padding:24px; }
  .report { margin-top:18px; white-space:pre-wrap; background:#f8fafc; padding:14px; border-radius:10px; }
  @media(max-width:700px){.converter-grid{grid-template-columns:1fr}}
`;

const JS = `
(function(){
  var form=document.getElementById('converter-form');
  var status=document.getElementById('status');
  var report=document.getElementById('report');
  form.onsubmit=function(ev){
    ev.preventDefault();
    status.textContent='Converting…';
    report.textContent='';
    fetch('/api/converter/convert',{method:'POST',body:new FormData(form)})
      .then(function(r){return r.json().then(function(body){return {ok:r.ok,body:body};});})
      .then(function(result){
        if(!result.ok) throw new Error(result.body.message||result.body.error);
        var out=result.body;
        report.textContent=JSON.stringify(out.fidelity,null,2);
        var bytes=Uint8Array.from(atob(out.output_base64),function(c){return c.charCodeAt(0);});
        var url=URL.createObjectURL(new Blob([bytes],{type:out.mime_type}));
        var a=document.createElement('a'); a.href=url; a.download=out.filename; a.textContent='Download '+out.filename;
        status.textContent=''; status.appendChild(a);
        setTimeout(function(){URL.revokeObjectURL(url);},60000);
      }).catch(function(err){status.textContent='Conversion failed: '+err.message;});
  };
})();
`;

function renderConverter() {
  return page('Canvas ↔ Moodle Quiz Converter', `
<div class="card">
  <h1>Canvas ↔ Moodle Quiz Converter</h1>
  <p class="muted">Convert Canvas QTI 1.2 packages and Moodle XML quizzes without losing embedded images. A fidelity report is always shown before download.</p>
  <form id="converter-form" class="drop">
    <div class="converter-grid">
      <label>Source file<input required type="file" name="file" accept=".zip,.xml"></label>
      <label>Output format<select name="to"><option value="moodle">Moodle XML</option><option value="canvas">Canvas QTI 1.2</option></select></label>
    </div>
    <p><button class="primary" type="submit">Convert</button></p>
  </form>
  <p id="status"></p>
  <pre id="report" class="report"></pre>
</div>`, CSS, JS);
}

module.exports = { renderConverter };
