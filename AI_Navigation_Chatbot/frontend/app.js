const $ = id => document.getElementById(id);
const savedTheme = localStorage.getItem("routemate-theme");
const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  const toggle = $("themeToggle");
  if (!toggle) return;
  toggle.setAttribute("aria-pressed", String(isDark));
  toggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  toggle.title = isDark ? "Switch to light theme" : "Switch to dark theme";
  toggle.querySelector(".theme-icon").textContent = isDark ? "☀" : "☾";
  toggle.querySelector(".theme-label").textContent = isDark ? "Light mode" : "Dark mode";
}
applyTheme(savedTheme || (prefersDark ? "dark" : "light"));
$("themeToggle").onclick = () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("routemate-theme", nextTheme);
  applyTheme(nextTheme);
};
let routeData = null, selectedRoute = 0, routeLayers = [], markerLayers = [], nearbyPlaceLayers = [], routeStopLayers = [], nearbyPlacesData = [], userLocation = null, locationEnabled = false, awaitingDestination = false, previousManualSource = "", stopCount = 0, lastAssistantReply = "";
const map = L.map("map").setView([28.6139, 77.2090], 11);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
const routeColors = ["#6957e8","#20a781","#f1a33c"];
async function api(path, options={}) {
  const headers = {"Content-Type":"application/json", ...(options.headers||{})};
  const res = await fetch(path, {...options, headers});
  let data={}; try{data=await res.json()}catch{}
  if(!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}
function setMessage(id, msg, ok=false){$(id).textContent=msg||"";$(id).style.color=ok?"#159b76":""}
async function checkHealth(){
  try{const h=await api("/api/health");$("serviceStatus").textContent=`API online · Ollama ${h.ollama}`;$("serviceStatus").style.color=h.ollama==="connected"?"#159b76":"#b87918"}
  catch{$("serviceStatus").textContent="Backend unavailable"}
}
function addStopInput(value=""){
  if(stopCount>=8){setMessage("routeMessage","Maximum 8 intermediate stops.");return}
  stopCount++;const row=document.createElement("div");row.className="stop-row";
  const input=document.createElement("input");input.placeholder=`Intermediate stop ${stopCount}`;input.className="stop-input";input.value=value;
  const remove=document.createElement("button");remove.className="remove-stop";remove.textContent="×";remove.type="button";remove.onclick=()=>{row.remove();stopCount=[...document.querySelectorAll(".stop-input")].length;document.querySelectorAll(".stop-input").forEach((el,i)=>el.placeholder=`Intermediate stop ${i+1}`)};
  row.append(input,remove);$("stops").append(row);
}
$("addStop").onclick=()=>addStopInput();
function clearMap(){routeLayers.forEach(x=>map.removeLayer(x));markerLayers.forEach(x=>map.removeLayer(x));nearbyPlaceLayers.forEach(x=>map.removeLayer(x));routeStopLayers.forEach(x=>map.removeLayer(x));routeLayers=[];markerLayers=[];nearbyPlaceLayers=[];routeStopLayers=[]}
function addPin(p,label,color){const marker=L.circleMarker([p.lat,p.lon],{radius:8,color:"#fff",weight:3,fillColor:color,fillOpacity:1}).addTo(map).bindPopup(`<strong>${escapeHtml(label)}</strong><br>${escapeHtml(p.name||"")}`);markerLayers.push(marker)}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function fmtDistance(m){return m>=1000?(m/1000).toFixed(1)+" km":Math.round(m)+" m"}
function fmtTime(s){let m=Math.round(s/60);return m>=60?`${Math.floor(m/60)} h ${m%60} min`:`${m} min`}
function distanceBetween(a,b){const r=Math.PI/180,dLat=(b.lat-a.lat)*r,dLon=(b.lon-a.lon)*r,x=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function sortNearby(places,point){const mode=$("nearbySort")?.value||"distance";return [...places].sort((a,b)=>mode==="name"?a.name.localeCompare(b.name):mode==="category"?a.category.localeCompare(b.category):a.distance_m-b.distance_m)}
function requestLocation(){return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error("This browser does not support GPS location."));$("locationStatus").textContent="Requesting location…";navigator.geolocation.getCurrentPosition(p=>{userLocation={lat:p.coords.latitude,lon:p.coords.longitude,name:"your current GPS location"};locationEnabled=true;$("locationToggle").setAttribute("aria-pressed","true");$("locationStatus").textContent="Current location";resolve(userLocation)},()=>{userLocation=null;locationEnabled=false;$("locationToggle").setAttribute("aria-pressed","false");$("locationStatus").textContent="Use my current location";reject(new Error("Location permission was not granted. Allow GPS access in your browser."))},{enableHighAccuracy:true,timeout:10000,maximumAge:60000})})}
function getNearbyPoint(){if(userLocation)return Promise.resolve(userLocation);if(routeData?.destination)return Promise.resolve(routeData.destination);return Promise.reject(new Error("Please turn on the “Use my location” toggle so I can search near you."))}
function drawRoute(index=0){
 if(!routeData)return;selectedRoute=index;clearMap();
 routeData.routes.forEach((r,i)=>{const coords=r.geometry.coordinates.map(c=>[c[1],c[0]]);const layer=L.polyline(coords,{color:routeColors[i%routeColors.length],weight:i===index?6:4,opacity:i===index?.92:.35,dashArray:i===index?null:"7 8"}).addTo(map);layer.on("click",()=>drawRoute(i));routeLayers.push(layer)});
 addPin(routeData.source,"Start","#19a779");routeData.stops.forEach((p,i)=>addPin(p,`Stop ${i+1}`,"#f3a53a"));addPin(routeData.destination,"Destination","#ef5a69");
 const points=[routeData.source,...routeData.stops,routeData.destination];const bounds=L.latLngBounds(points.map(p=>[p.lat,p.lon]));routeLayers.forEach(l=>bounds.extend(l.getBounds()));map.fitBounds(bounds.pad(.16));
 renderRouteDetails(index);
}
async function loadRouteStops(geometry){
 try{const data=await api("/api/route-stops",{method:"POST",body:JSON.stringify({geometry})});routeStopLayers.forEach(x=>map.removeLayer(x));routeStopLayers=[];data.stops.forEach(p=>{const marker=L.circleMarker([p.lat,p.lon],{radius:6,color:"#fff",weight:2,fillColor:"#3978d6",fillOpacity:.95}).addTo(map).bindPopup(`<strong>${escapeHtml(p.name)}</strong><br>Bus stop along route`);routeStopLayers.push(marker)});$("routeStops").innerHTML=data.stops.length?`<div class="route-stop-heading"><strong>${data.stops.length} route stops found</strong><small>Bus stops mapped within 500 m of your route</small></div><div class="route-stop-list">${data.stops.map((p,i)=>`<button type="button" class="route-stop-item" data-route-stop="${i}"><span class="route-stop-icon">●</span><span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.category||"Bus stop")}</small></span></button>`).join("")}</div>`:`<div class="route-stop-heading"><strong>No mapped bus stops found</strong><small>OpenStreetMap coverage varies by area.</small></div>`;document.querySelectorAll("[data-route-stop]").forEach(el=>el.onclick=()=>{const p=data.stops[Number(el.dataset.routeStop)];map.setView([p.lat,p.lon],16);const marker=routeStopLayers[Number(el.dataset.routeStop)];if(marker)marker.openPopup()})}
 catch(err){$("routeStops").innerHTML=`<div class="route-stop-heading"><strong>Route stops unavailable</strong><small>${escapeHtml(err.message)}</small></div>`}
}
function renderRouteDetails(index){
 const r=routeData.routes[index];$("routeResults").classList.remove("hidden");$("distance").textContent=fmtDistance(r.distance_m);$("duration").textContent=fmtTime(r.duration_s);
 const journeyPoints=[{name:routeData.source.name,type:"Start"},...routeData.stops.map(p=>({name:p.name,type:"Stop"})),{name:routeData.destination.name,type:"Destination"}];$("journeyTimeline").innerHTML=journeyPoints.length>2?journeyPoints.map((p,i)=>`<div class="journey-point"><span class="journey-marker ${i===0||i===journeyPoints.length-1?"terminal":""}"></span><div><strong>${escapeHtml(p.type)}: ${escapeHtml(p.name)}</strong></div></div>`).join(""):"";
 $("alternativesList").innerHTML=routeData.routes.map((x,i)=>`<div class="route-choice ${i===index?"selected":""}" data-route="${i}"><strong>${i===0?"Recommended route":`Alternative ${i}`}</strong><small>${fmtDistance(x.distance_m)} · ${fmtTime(x.duration_s)} · ${i===index?"Selected":"Click to view"}</small></div>`).join("");
 document.querySelectorAll("[data-route]").forEach(el=>el.onclick=()=>drawRoute(Number(el.dataset.route)));
 const steps=r.legs.flatMap(leg=>leg.steps).slice(0,60);
 $("directions").innerHTML=steps.map((s,i)=>{const detail=`${s.modifier?escapeHtml(s.modifier)+" · ":""}${s.road!=="Unnamed road"?"onto "+escapeHtml(s.road):"Continue"}`;return `<li><span class="direction-node">${i+1}</span><div class="direction-copy"><strong>${escapeHtml(s.instruction)}</strong><small>${detail}</small></div><span class="direction-meta">${fmtDistance(s.distance_m)}<br>${fmtTime(s.duration_s)}</span></li>`}).join("")||"<li><div class=\"direction-copy\"><strong>No turn-by-turn steps returned.</strong></div></li>";
}
$("planRoute").onclick=async()=>{
 const source=$("source").value.trim(),destination=$("destination").value.trim(),stops=[...document.querySelectorAll(".stop-input")].map(x=>x.value.trim()).filter(Boolean);
 if(!source||!destination){setMessage("routeMessage","Enter both a starting point and a destination.");return}
 $("planRoute").disabled=true;$("planRoute").textContent="Calculating route…";setMessage("routeMessage","");
  try{routeData=await api("/api/route",{method:"POST",body:JSON.stringify({source,destination,stops,alternatives:$("alternatives").checked,travel_mode:"driving",route_preference:$("routePreference").value})});drawRoute(0);setMessage("routeMessage","Route calculated. Nearby places and trip estimates updated automatically.",true);$("findNearby").click();$("estimateEV").click();$("chatLog").insertAdjacentHTML("beforeend",`<div class="bubble assistant">Route ready: ${routeData.summary.distance_km} km, about ${routeData.summary.duration_min} minutes. Ask me about this journey.</div>`)}
 catch(err){setMessage("routeMessage",err.message)}finally{$("planRoute").disabled=false;$("planRoute").innerHTML='Find route <span>→</span>'}
};
$("findNearby").onclick=async()=>{
 let point;try{point=await getNearbyPoint()}catch(err){setMessage("nearbyResults",err.message);return}
 $("nearbyResults").textContent="Searching…";
 try{const data=await api("/api/nearby",{method:"POST",body:JSON.stringify({lat:point.lat,lon:point.lon,category:$("nearbyCategory").value,radius_m:Number($("nearbyRadius").value)})});nearbyPlacesData=data.places.map(p=>({...p,distance_m:distanceBetween(point,p)}));const places=sortNearby(nearbyPlacesData,point);nearbyPlaceLayers.forEach(x=>map.removeLayer(x));nearbyPlaceLayers=[];places.forEach(p=>{const marker=L.marker([p.lat,p.lon]).addTo(map).bindPopup(`<strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(p.category)}<br>${fmtDistance(p.distance_m)} away${p.address?"<br>"+escapeHtml(p.address):""}`);nearbyPlaceLayers.push(marker)});if(places.length){const bounds=L.latLngBounds(places.map(p=>[p.lat,p.lon]));map.fitBounds(bounds.pad(.15))}
 $("nearbyResults").innerHTML=places.length?places.map((p,i)=>`<div class="place-item" data-place="${i}"><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.category)}${p.address?" · "+escapeHtml(p.address):""}</small></div><button type="button">View</button></div>`).join():"<p class='muted'>No mapped places found nearby. Try a larger radius or another category.</p>";
 document.querySelectorAll("[data-place]").forEach(el=>el.onclick=()=>{const i=Number(el.dataset.place),p=places[i];map.setView([p.lat,p.lon],16);nearbyPlaceLayers[i]?.openPopup()});
 }catch(err){$("nearbyResults").textContent=err.message}
};
$("nearbySort").onchange=()=>{if(routeData||nearbyPlacesData.length)$('findNearby').click()};
$("locationToggle").onclick=async()=>{if(!locationEnabled){previousManualSource=$("source").value;try{const point=await requestLocation();$("source").value=`${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;$("source").title="Using current GPS location as the route start";setMessage("routeMessage","Current GPS location is now the route starting point.",true)}catch(err){setMessage("routeMessage",err.message)}}else{userLocation=null;locationEnabled=false;$("locationToggle").setAttribute("aria-pressed","false");$("locationStatus").textContent="Use my current location";$("source").value=previousManualSource;$("source").title="";setMessage("routeMessage","Manual starting point restored.",true)}};
$("estimateEV").onclick=async()=>{
 if(!routeData){$("evResult").textContent="Plan a route first.";return}
 const distance=routeData.routes[selectedRoute].distance_m/1000,eff=Number($("efficiency").value),price=Number($("electricityPrice").value);
 try{const d=await api(`/api/ev-estimate?distance_km=${distance}&efficiency_kwh_100km=${eff}&price_per_kwh=${price}`,{method:"POST"});$("evResult").textContent=`≈ ${d.estimated_energy_kwh} kWh · ₹${d.estimated_cost} estimated. ${d.assumptions}`}
 catch(err){$("evResult").textContent=err.message}
};
function parseChatRoute(text){const match=text.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:and\s+)?(?:find|show|search|look|near|around)\b|[.!?]|$)/i)||text.match(/\bbetween\s+(.+?)\s+and\s+(.+?)(?=\s+(?:and\s+)?(?:find|show|search|look|near|around)\b|[.!?]|$)/i);return match?{source:match[1].trim(),destination:match[2].trim()}:null}
function nearbyCategoryFromText(text){const match=text.match(/\b(caf(?:e|Ã©s?)|restaurants?|hotels?|petrol|fuel|hospitals?|pharmacies?|atms?|charging|parking)\b/i);if(!match)return null;const word=match[1].toLowerCase();return /caf|restaurant/.test(word)?"restaurant":word.startsWith("hotel")?"hotel":word.startsWith("petrol")||word.startsWith("fuel")?"petrol":word.startsWith("hospital")?"hospital":word.startsWith("pharmac")?"pharmacy":word.startsWith("atm")?"atm":word.startsWith("charg")?"charging":"parking"}
function parseChatRoute(text){const match=text.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:and\s+)?(?:find|show|search|look|near|around)\b|[.!?]|$)/i)||text.match(/\bbetween\s+(.+?)\s+and\s+(.+?)(?=\s+(?:and\s+)?(?:find|show|search|look|near|around)\b|[.!?]|$)/i)||text.match(/\b(?:take me|go|travel|route)\s+to\s+(.+?)\s+from\s+(.+?)(?=\s+(?:and\s+)?(?:find|show|search|look|near|around)\b|[.!?]|$)/i);return match?{source:match[3]?match[2].trim():match[1].trim(),destination:match[3]?match[1].trim():match[2].trim()}:null}
function nearbyCategoryFromText(text){const match=text.match(/\b(caf(?:e|és?)|restaurants?|hotels?|petrol|fuel|hospitals?|pharmacies?|atms?|charging|parking)\b/i);if(!match)return /\bplaces?\b/i.test(text)?"restaurant":null;const word=match[1].toLowerCase();return /caf|restaurant/.test(word)?"restaurant":word.startsWith("hotel")?"hotel":word.startsWith("petrol")||word.startsWith("fuel")?"petrol":word.startsWith("hospital")?"hospital":word.startsWith("pharmac")?"pharmacy":word.startsWith("atm")?"atm":word.startsWith("charg")?"charging":"parking"}
function parseChatRoute(text){const direct=text.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:and\s+)?(?:find|show|search|look|near|around)\b|[.!?]|$)/i)||text.match(/\bbetween\s+(.+?)\s+and\s+(.+?)(?=\s+(?:and\s+)?(?:find|show|search|look|near|around)\b|[.!?]|$)/i);if(direct)return{source:direct[1].trim(),destination:direct[2].trim()};const reverse=text.match(/\b(?:take me|go|travel|route)\s+to\s+(.+?)\s+from\s+(.+?)(?=\s+(?:and\s+)?(?:find|show|search|look|near|around)\b|[.!?]|$)/i);return reverse?{source:reverse[2].trim(),destination:reverse[1].trim()}:null}
async function sendChat(text){
  const clearRequest=/\b(clear|reset|remove)\s+(?:the\s+)?route\b/i.test(text);
  if(clearRequest){addBubble(text,"user");routeData=null;selectedRoute=0;clearMap();$("routeResults").classList.add("hidden");$("nearbyResults").innerHTML="";addBubble("I cleared the current route and map results.","assistant");return}
  const changeDestination=text.match(/\b(?:change|set|update)\s+(?:the\s+)?destination\s+(?:to\s+)?(.+?)(?:[.!?]|$)/i);
  if(changeDestination){addBubble(text,"user");$("chatInput").value="";$("destination").value=changeDestination[1].trim();addBubble(`I changed the destination to ${changeDestination[1].trim()} and will recalculate the route.`,"assistant");$("planRoute").click();return}
  const navigateTo=text.match(/\b(?:navigate|take me|route me)\s+to\s+(.+?)(?:[.!?]|$)/i);
  if(navigateTo){addBubble(text,"user");$("chatInput").value="";$("destination").value=navigateTo[1].trim();addBubble(`I’ll navigate you to ${navigateTo[1].trim()} and calculate the route.`,"assistant");$("planRoute").click();return}
  const addStop=text.match(/\b(?:add|include)\s+(?:a\s+)?stop\s+(?:at\s+)?(.+?)(?:[.!?]|$)/i);
  if(addStop){addBubble(text,"user");$("chatInput").value="";addStopInput(addStop[1].trim());if($("source").value&&$("destination").value){addBubble(`I added ${addStop[1].trim()} as a stop and will recalculate the route.`,"assistant");$("planRoute").click()}else addBubble(`I added ${addStop[1].trim()} as a stop. Please provide a destination to calculate the route.`,"assistant");return}
  const currentLocationRequest=/\b(current location|my location|where i am|gps location|use my gps)\b/i.test(text);
   if(currentLocationRequest&&!/\bfrom\b/i.test(text)){addBubble(text,"user");$("chatInput").value="";try{const point=await requestLocation();awaitingDestination=true;$("source").value=`${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;$("destination").focus();addBubble("I have your current GPS location and set it as the starting point. What destination should I route you to?","assistant")}catch(err){addBubble(err.message,"assistant")}return}
   if(awaitingDestination&&!currentLocationRequest&&!nearbyCategoryFromText(text)&&!/\bplaces?\b/i.test(text)){awaitingDestination=false;addBubble(text,"user");$("chatInput").value="";$("destination").value=text.trim();addBubble(`I set ${text.trim()} as your destination and will calculate the route from your current location.`,"assistant");$("planRoute").click();return}
  if(/\bplaces?\b/i.test(text)&&/\b(near|nearby|around|closest|nearest|find|show|search)\b/i.test(text)){addBubble(text,"user");$("chatInput").value="";$('nearbyCategory').value="restaurant";if(!userLocation){addBubble("Please turn on the Use my current location switch and allow GPS access, then ask me again.","assistant");return}await $('findNearby').click();addBubble(`I searched for nearby places and sorted them by ${$('nearbySort').value}.`,"assistant");return}
  const routeMatch=parseChatRoute(text);
  if(routeMatch){addBubble(text,"user");$("chatInput").value="";let source=routeMatch.source;if(currentLocationRequest){try{const point=await requestLocation();source=`${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`}catch(err){addBubble(err.message,"assistant");return}}$('source').value=source;$('destination').value=routeMatch.destination;const requestedCategory=nearbyCategoryFromText(text);if(requestedCategory){$('nearbyCategory').value=requestedCategory;$('nearbySort').value=/\b(name|alphabet|a.?z)\b/i.test(text)?"name":"distance"}addBubble(`I’m setting the route from ${currentLocationRequest?"your current location":source} to ${routeMatch.destination}${requestedCategory?` and will show nearby ${requestedCategory} places`:""}.`,"assistant");$('planRoute').click();return}
  const nearbyMatch=text.match(/\b(caf(?:e|és?)|restaurants?|hotels?|petrol|fuel|hospitals?|pharmacies?|atms?|charging|parking)\b/i);
  if(nearbyMatch&&/\b(near|nearby|around|closest|nearest|find|show|search)\b/i.test(text)){const word=nearbyMatch[1].toLowerCase();const category=/caf|restaurant/.test(word)?"restaurant":word.startsWith("hotel")?"hotel":word.startsWith("petrol")||word.startsWith("fuel")?"petrol":word.startsWith("hospital")?"hospital":word.startsWith("pharmac")?"pharmacy":word.startsWith("atm")?"atm":word.startsWith("charg")?"charging":"parking";$("nearbyCategory").value=category;$("nearbySort").value=/\b(name|alphabet|a.?z)\b/i.test(text)?"name":"distance";addBubble(text,"user");$("chatInput").value="";if(!userLocation){addBubble("Please turn on the “Use my location” toggle and allow GPS access, then ask me again.","assistant");return}await $("findNearby").click();addBubble(`I searched for ${category} and sorted the results by ${$("nearbySort").value}.`,"assistant");return}
 if(!text.trim())return;addBubble(text,"user");$("chatInput").value="";const waiting=addBubble("Thinking with Ollama…","assistant");
 try{const context=routeData?{source:routeData.source.name,destination:routeData.destination.name,stops:routeData.stops.map(s=>s.name),distance_km:routeData.routes[selectedRoute].distance_m/1000,estimated_duration_min:routeData.routes[selectedRoute].duration_s/60,traffic_status:"not connected"}:{ };
 const d=await api("/api/chat",{method:"POST",body:JSON.stringify({message:text,context})});waiting.textContent=d.reply;lastAssistantReply=d.reply}
 catch(err){waiting.textContent=err.message}
}
function addBubble(text,role){const div=document.createElement("div");div.className=`bubble ${role}`;div.textContent=text;$("chatLog").append(div);$("chatLog").scrollTop=$("chatLog").scrollHeight;return div}
$("refreshChat").onclick=()=>{$("chatLog").innerHTML='<div class="bubble assistant">Hi! I’m RouteMate. Plan a route, then ask me about your journey. I run on your local Ollama model.</div>';$("chatInput").value="";lastAssistantReply="";$("voiceStatus").textContent="Voice depends on browser support"};
$("chatForm").onsubmit=e=>{e.preventDefault();sendChat($("chatInput").value)};
document.querySelectorAll("[data-prompt]").forEach(b=>b.onclick=()=>sendChat(b.dataset.prompt));
$("speakLast").onclick=()=>{if(!lastAssistantReply)return; if(!("speechSynthesis"in window)){ $("voiceStatus").textContent="Speech synthesis unsupported";return}speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(lastAssistantReply));};
$("voiceInput").onclick=()=>{
 const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Recognition){$("voiceStatus").textContent="Speech recognition unsupported in this browser.";return}
 const rec=new Recognition();rec.lang="en-IN";rec.interimResults=false;rec.onstart=()=>$("voiceStatus").textContent="Listening…";rec.onerror=()=> $("voiceStatus").textContent="Could not recognize speech.";
 rec.onresult=e=>{$("chatInput").value=e.results[0][0].transcript;$("voiceStatus").textContent="Voice captured — sending…";sendChat($("chatInput").value)};rec.onend=()=>{if($("voiceStatus").textContent==="Listening…")$("voiceStatus").textContent="Voice input ended"};rec.start();
};
$("saveTrip").onclick=async()=>{if(!routeData)return;try{await api("/api/trips",{method:"POST",body:JSON.stringify({title:`${$("source").value} → ${$("destination").value}`,source:$("source").value,destination:$("destination").value,stops:[...document.querySelectorAll(".stop-input")].map(x=>x.value).filter(Boolean)})});setMessage("routeMessage","Journey saved.",true);loadTrips()}catch(err){setMessage("routeMessage",err.message)}};
async function loadTrips(){try{const d=await api("/api/trips");$("savedTrips").innerHTML=d.trips.length?d.trips.map(t=>`<div class="place-item"><div><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(t.source)} → ${escapeHtml(t.destination)}</small></div><button data-load="${t.id}">Load</button></div>`).join():"<p class='muted'>No saved journeys yet.</p>";document.querySelectorAll("[data-load]").forEach(b=>b.onclick=()=>{const t=d.trips.find(x=>x.id===Number(b.dataset.load));$("source").value=t.source;$("destination").value=t.destination;$("stops").innerHTML="";stopCount=0;t.stops.forEach(s=>addStopInput(s));window.scrollTo({top:0,behavior:"smooth"})})}catch{}}
checkHealth();setInterval(checkHealth,30000);loadTrips();
