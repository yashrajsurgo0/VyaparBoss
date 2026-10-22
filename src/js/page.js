/* Small script for the standalone pages (privacy, terms, contact, 404). No inline scripts, so the CSP stays strict. */
(function(){
  try{if(localStorage.getItem("vyaparboss.v1.theme")==="dark")document.documentElement.dataset.look="dark";}catch(e){}
  // On the GitHub Pages copy the API lives on the live server.
  var API=/github\.io$/.test(location.hostname)?"https://vyaparboss.onrender.com/":"";
  function ready(fn){document.readyState==="loading"?document.addEventListener("DOMContentLoaded",fn):fn();}
  ready(function(){
    var f=document.getElementById("contactForm");if(!f)return;
    var topic=document.getElementById("cTopic"),hint=document.getElementById("cDeleteHint"),err=document.getElementById("cErr"),btn=document.getElementById("cSend");
    var q=new URLSearchParams(location.search).get("topic");
    if(q&&topic.querySelector('option[value="'+q.replace(/[^a-z]/g,"")+'"]'))topic.value=q;
    var sync=function(){hint.hidden=topic.value!=="delete";};topic.addEventListener("change",sync);sync();
    f.addEventListener("submit",function(e){
      e.preventDefault();err.hidden=true;
      var body={name:f.name.value,email:f.email.value.trim(),topic:topic.value,text:f.text.value.trim(),website:f.website.value};
      var problems=[];if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))problems.push("Enter an email so we can reply");if(body.text.length<5)problems.push("Write a short message");
      if(problems.length){err.textContent=problems.join(". ");err.hidden=false;return;}
      btn.disabled=true;btn.textContent="Sending…";
      fetch(API+"api/contact",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})
        .then(function(r){return r.json().catch(function(){return{};}).then(function(j){if(!r.ok)throw new Error(j.error||"Couldn't send. Please try again.");});})
        .then(function(){f.hidden=true;document.getElementById("cDone").hidden=false;})
        .catch(function(x){err.textContent=x.message==="Failed to fetch"?"Couldn't reach KaantaMandi. Check your connection and try again.":x.message;err.hidden=false;btn.disabled=false;btn.textContent="Send message";});
    });
  });
})();
