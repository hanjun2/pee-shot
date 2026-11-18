import * as THREE from './vendor/three.module.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TAU=Math.PI*2;
window.createBathroomRenderer=function(canvas,arena){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#b7c2bc');scene.fog=new THREE.Fog('#c0c9c0',135,350);
  const camera=new THREE.PerspectiveCamera(55,1.6,.08,500),vmScene=new THREE.Scene(),vmCam=new THREE.PerspectiveCamera(52,1.6,.015,8);
  const mats=new Map(),actors=new Map(),props=new Map();
  const material=(color,roughness=.65,metalness=0)=>{const key=color+'/'+roughness+'/'+metalness;if(!mats.has(key))mats.set(key,new THREE.MeshStandardMaterial({color,roughness,metalness}));return mats.get(key);};
  const boxGeo=new THREE.BoxGeometry(1,1,1,3,3,3);
  const attr=boxGeo.attributes.position,v=new THREE.Vector3(),inner=new THREE.Vector3();
  for(let i=0;i<attr.count;i++){v.fromBufferAttribute(attr,i);inner.copy(v).clampScalar(-.43,.43);v.sub(inner).normalize().multiplyScalar(.07).add(inner);attr.setXYZ(i,v.x,v.y,v.z);}boxGeo.computeVertexNormals();
  const sphereGeo=new THREE.SphereGeometry(1,16,10),cylGeo=new THREE.CylinderGeometry(1,1,1,16),capsuleGeo=new THREE.CapsuleGeometry(.5,1,4,10);
  function mesh(geo,mat,x,y,z,sx=1,sy=1,sz=1,parent=scene){const m=new THREE.Mesh(geo,typeof mat==='string'?material(mat):mat);m.position.set(x,y,-z);m.scale.set(sx,sy,sz);m.receiveShadow=true;parent.add(m);return m;}
  function box(x,y,z,w,h,d,color,parent=scene){return mesh(boxGeo,color,x,y,z,w,h,d,parent);}
  function sphere(x,y,z,w,h,d,color,parent=scene){return mesh(sphereGeo,color,x,y,z,w,h,d,parent);}
  function cylinder(x,y,z,r,h,color,parent=scene){return mesh(cylGeo,color,x,y,z,r,h,r,parent);}
  const porcelain=material('#e7e7dc',.24,.02),chrome=material('#b6c3c1',.22,.72),wood=material('#957251',.8),dark=material('#203b40',.65),mint=material('#98c5b0',.55);
  function tileTexture(a,b,grout,rows=4){
    const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');g.fillStyle=grout;g.fillRect(0,0,256,256);
    for(let y=0;y<rows;y++)for(let x=0;x<rows;x++){g.fillStyle=(x+y)%3===0?b:a;g.fillRect(x*256/rows+1,y*256/rows+1,256/rows-2,256/rows-2);}
    // Fine ceramic flecks, generated once rather than updated each frame.
    let seed=51;for(let i=0;i<6500;i++){seed=(seed*1664525+1013904223)>>>0;const x=seed>>>24;seed=(seed*1664525+1013904223)>>>0;const y=seed>>>24;g.fillStyle=i%2?'#ffffff0b':'#17282409';g.fillRect(x,y,1,1);}
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());return t;
  }
  function surfaceTexture(kind){
    const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');
    let seed=327;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    if(kind==='oak'){
      g.fillStyle='#9a7857';g.fillRect(0,0,512,512);
      for(let plank=0;plank<8;plank++){
        const x=plank*64;g.fillStyle=['#b99368','#c39d72','#ad895f','#bd976c'][plank%4];g.fillRect(x+1,0,62,512);
        for(let i=0;i<95;i++){
          const gx=x+2+random()*59,phase=random()*TAU;
          g.strokeStyle=i%3?'rgba(87,56,31,.10)':'rgba(244,215,164,.22)';g.lineWidth=.4+random()*.8;g.beginPath();
          for(let y=0;y<=512;y+=8){const px=gx+Math.sin(y*.019+phase)*1.5+Math.sin(y*.045+phase)*.4;y?g.lineTo(px,y):g.moveTo(px,y);}g.stroke();
        }
        const joint=(plank%3)*64+96;g.fillStyle='#72563c88';g.fillRect(x,joint,64,1);g.fillRect(x,joint+256,64,1);
        g.fillStyle='#efd4a655';g.fillRect(x+1,0,1,512);
      }
    }else{
      g.fillStyle='#d0c5b0';g.fillRect(0,0,512,512);
      for(let i=0;i<30000;i++){g.fillStyle=i%2?'#f8f0db18':'#6a665610';g.fillRect(random()*512,random()*512,1,1+random()*2);}
      g.strokeStyle='#f4ead713';for(let x=0;x<512;x+=4){g.beginPath();g.moveTo(x,0);g.lineTo(x,512);g.stroke();}
    }
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());return t;
  }
  const oakTex=surfaceTexture('oak');wood.map=oakTex;wood.color.set('#ffffff');wood.roughness=.72;
  const floorOak=oakTex.clone();floorOak.repeat.set(3,3);floorOak.needsUpdate=true;
  const oakFloorMat=new THREE.MeshStandardMaterial({map:floorOak,roughness:.74});
  const plasterTex=surfaceTexture('plaster');plasterTex.repeat.set(3,2);
  const plasterMat=new THREE.MeshStandardMaterial({map:plasterTex,roughness:.96});
  function label(text,sub,bg='#233e43',fg='#edf0d7'){
    const c=document.createElement('canvas');c.width=512;c.height=192;const g=c.getContext('2d');
    g.fillStyle=bg;g.fillRect(0,0,512,192);g.textAlign='center';g.fillStyle=fg;g.font='900 58px sans-serif';g.fillText(text,256,95);g.font='19px sans-serif';g.fillText(sub,256,139);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:t});
  }
  function sign(x,y,z,w,h,text,sub,bg,fg){const m=mesh(new THREE.PlaneGeometry(w,h),label(text,sub,bg,fg),x,y,z);return m;}
  const ambient=new THREE.HemisphereLight('#e8f2e5','#677b73',2.0);scene.add(ambient);
  const key=new THREE.DirectionalLight('#fff0d2',2.9);key.position.set(45,110,35);key.target.position.set(0,7,-30);scene.add(key,key.target);
  key.castShadow=true;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-85,right:85,top:110,bottom:-95,near:1,far:260});key.shadow.bias=-.0008;key.shadow.normalBias=.09;
  const fill=new THREE.PointLight('#c6e8f0',550,220,2);fill.position.set(-70,60,-20);scene.add(fill);
  // Home bathroom: warm plaster, quiet green tile, cabinet, shower, towels and a wooden door.
  const floorTex=tileTexture('#858980','#8c9187','#b8bbae');floorTex.repeat.set(3,3);
  const floorMat=new THREE.MeshStandardMaterial({map:floorTex,roughness:.78});
  box(0,-19,-9,326,2,320,floorMat);
  const wallTex=tileTexture('#aec4b5','#b7c9ba','#dce0cf',4);wallTex.repeat.set(4,2);
  const wallMat=new THREE.MeshStandardMaterial({map:wallTex,roughness:.58});
  box(-162,38,-9,3,112,320,wallMat);box(162,38,-9,3,112,320,wallMat);box(0,38,148,326,112,3,wallMat);box(-61,38,-169,200,112,3,wallMat);box(121,38,-169,80,112,3,wallMat);box(59,89,-169,42,10,3,wallMat);
  for(const x of [-162,162])box(x,111,-9,3,35,320,'#dbd9c8');
  box(0,111,148,326,35,3,'#dbd9c8');box(0,111,-169,326,35,3,'#dbd9c8');
  box(0,130,-9,328,2,318,'#d4d4c6');
  box(0,127,25,42,1,20,material('#fff4cf',.5));

  // Open doorway connects the bathroom to a furnished living room.
  const door=new THREE.Group();scene.add(door);door.position.set(80,-18,169);door.rotation.y=-1.25;
  box(-20,44,0,40,88,2,wood,door);box(-35,44,-2,1,8,2,chrome,door);
  box(0,-19,-335,326,2,330,oakFloorMat);
  box(-162,55,-335,3,150,332,plasterMat);box(162,55,-335,3,150,332,plasterMat);box(0,55,-501,326,150,3,plasterMat);
  box(0,130,-335,326,2,330,'#ded7c4');
  const livingFurniture=new Set(scene.children);
  box(-64,-5,-202,62,24,48,'#6f8980');box(-92,20,-202,10,43,51,'#6f8980');
  for(const z of [-221,-201,-181]){box(-64,7,z,43,6,18,'#97aba0');box(-63,17,z,24,14,14,'#bdba9d');}
  box(-64,7,-229,64,31,8,'#6f8980');box(-64,7,-175,64,31,8,'#6f8980');
  box(-5,-17.5,-200,67,.8,78,'#b4a88f');
  box(-11,-1,-200,38,3,30,'#9a7755');
  for(const x of [-25,3])for(const z of [-211,-189])box(x,-9,z,3,15,3,'#6c5543');
  box(-12,2,-201,9,1.3,12,'#546d72');cylinder(1,4,-200,2.3,4,'#d4d2bd');
  box(81,0,-226,34,34,48,'#997751');box(81,31,-236,38,25,3,'#293d42');const tvScreen=box(81,31,-233.9,34,21,.2,'#536d76');tvScreen.userData.dynamic=true;
  const tvOff=tvScreen.material,tvOn=label('긴급 속보','변기에서 전투 발생!','#214d49','#e9e0a9');
  box(0,60,-418,100,65,2,wood);box(0,60,-416.5,95,60,1,new THREE.MeshBasicMaterial({color:'#d8e8df'}));
  box(0,60,-415.6,2,60,1,'#eee1c7');box(0,60,-415.5,95,2,1,'#eee1c7');
  box(59,127,-180,33,2,23,'#ede3b9');
  const homeLight=new THREE.PointLight('#ffe3ba',1400,210,2);homeLight.position.set(25,80,185);scene.add(homeLight);
  for(const item of scene.children)if(!livingFurniture.has(item))item.position.z+=80;
  // Soft prepainted window light: one transparent quad, no extra shadow pass.
  const sunCanvas=document.createElement('canvas');sunCanvas.width=sunCanvas.height=256;const sg=sunCanvas.getContext('2d');
  const glow=sg.createRadialGradient(128,128,35,128,128,126);glow.addColorStop(0,'#fff0c884');glow.addColorStop(1,'#fff0c800');sg.fillStyle=glow;sg.fillRect(0,0,256,256);
  sg.globalCompositeOperation='destination-out';sg.fillStyle='#000';sg.fillRect(123,0,10,256);sg.fillRect(0,123,256,9);
  const sunTex=new THREE.CanvasTexture(sunCanvas);sunTex.colorSpace=THREE.SRGBColorSpace;
  const sunPatch=mesh(new THREE.PlaneGeometry(112,150),new THREE.MeshBasicMaterial({map:sunTex,transparent:true,opacity:.45,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}),-9,-17.1,-414);
  sunPatch.rotation.set(-Math.PI/2,0,-.18);
  // Kitchen and a breakfast counter occupy the added living-room width.
  box(-141,3,-243,32,42,98,'#7a9989');box(-141,25,-243,35,3,101,porcelain);
  for(const z of [-273,-245,-215]){box(-123.5,2,z,1,35,25,'#8eaa96');box(-122,10,z,1,2,10,chrome);}
  box(-143,54,-215,27,51,31,'#d9d7c4');box(-128,59,-215,1,2,17,chrome);
  cylinder(-140,28,-257,9,1,'#394f4c');cylinder(-140,29,-257,6,2,chrome);
  box(124,5,-236,30,3,50,wood);for(const z of [-252,-219]){cylinder(124,-6,z,7,19,'#749589');}
  sign(-4,104,-497,48,16,'HOME','천천히 둘러보세요','#537769','#ede5c9').rotation.y=Math.PI;
  for(const x of [-58,58])for(let i=0;i<4;i++)box(x+(i-1.5)*3,57,-492,4,78,5,'#a8b6a3');
  box(0,99,-490,132,3,4,wood);
  for(const z of [-276,-220]){box(-153,73,z,16,42,46,'#859d8c');box(-144,73,z,1,37,40,'#b7c4aa');box(-143,68,z,1,2,13,chrome);}
  // A larger, zoned home: dining room, reading nook and laundry alcove.
  for(const x of [-159,159]){box(x,-13,-335,2,9,330,'#eadfc8');box(x,114,-335,3,4,330,'#9b8669');}
  box(0,-13,-498,320,9,2,'#eadfc8');
  box(61,-17.7,-414,108,.5,103,'#677f77');
  for(const x of [15,107])box(x,-17.35,-414,1,.12,94,'#b7b599');
  box(62,7,-414,64,4,56,wood);
  for(const x of [38,86])for(const z of [-394,-434])box(x,-5,z,3,23,3,'#594b3d');
  for(const z of [-374,-454]){box(62,-2,z,26,4,24,'#a07e59');box(62,12,z+(z<-414?-10:10),26,25,3,'#a07e59');for(const x of [52,72])box(x,-10,z,3,16,18,'#604f3c');}
  cylinder(62,12,-414,7,5,'#d5be94');for(let i=0;i<5;i++)sphere(62+Math.sin(i*2.4)*4,16,-414+Math.cos(i*2.4)*4,2.8,2.8,2.8,i%2?'#c6a55a':'#bb7858');
  cylinder(62,95,-414,.7,65,chrome);const shade=cylinder(62,64,-414,16,10,'#bd9c74');
  cylinder(62,58.8,-414,14,.5,new THREE.MeshBasicMaterial({color:'#ffe7b0'}));
  box(-92,-17.7,-419,102,.5,104,'#9a9b83');
  box(-106,-4,-426,43,25,42,'#aa8069');box(-106,19,-444,43,36,8,'#aa8069');
  for(const x of [-129,-83])box(x,5,-426,6,31,46,'#876852');
  cylinder(-55,-5,-422,14,24,wood);box(-54,8,-423,12,1.3,17,'#4b7470');
  cylinder(-142,23,-468,.8,82,chrome);cylinder(-142,66,-468,13,15,'#d7bf91');
  box(-150,36,-370,16,106,44,'#755c46');
  for(const y of [-12,15,42,68,88])box(-140,y,-370,28,2,46,'#a68b65');
  for(let i=0;i<13;i++)box(-135,27+(i%3)*27,-390+(i%5)*8,16,18,5,['#718f86','#c0a47a','#8f7775'][i%3]);
  for(const z of [-310,-205]){const art=box(158,57,z,1.4,33,48,'#8e7458');box(156.9,57,z,1,28,43,'#c8c3a3');sphere(156,59,z,1,9,13,'#6c9180');}
  // Panel trim and a tall storage cabinet give the bathroom a deliberate layout.
  for(const x of [-159,159]){box(x,-13,-9,2,9,316,'#e0d9c6');box(x,83,-9,2,2,316,'#8ca99a');}
  box(0,-13,145,318,9,2,'#e0d9c6');
  for(const x of [119,155])box(x,29,-96,2,94,52,'#768f80');
  box(137,29,-121,35,94,2,'#768f80');
  for(const y of [-15,11,39,73])box(137,y,-96,35,2,52,'#c9b79a');
  for(let i=0;i<3;i++)box(130+i*5,47,-92,5,12,15,['#cba28a','#a9b7a3','#ddd0ad'][i]);
  const cabinetDoor=new THREE.Group();scene.add(cabinetDoor);cabinetDoor.position.set(119,-17,68);
  box(17,45,0,34,91,2,'#9bb09a',cabinetDoor);box(29,45,-2,2,12,2,chrome,cabinetDoor);
  const secretDuck=new THREE.Group();scene.add(secretDuck);secretDuck.position.set(137,17,91);
  sphere(0,0,0,7,5,8,'#dfbe5e',secretDuck);sphere(0,5,-4,4,4,4,'#efd275',secretDuck);box(0,4,-8,5,2,3,'#d4914c',secretDuck);
  for(const x of [-1.7,1.7])sphere(x,6,-7,.5,.5,.3,'#203b40',secretDuck);
  box(132,4,-473,43,44,43,'#d7d9c9');box(132,21,-450.8,39,5,1,'#647b75');
  const washerDrum=new THREE.Group();scene.add(washerDrum);washerDrum.position.set(132,0,450);
  const washerRim=mesh(new THREE.TorusGeometry(13,2,8,32),chrome,0,0,0,1,1,1,washerDrum);
  mesh(new THREE.CircleGeometry(11.5,24),'#344e54',0,0,-.1,1,1,1,washerDrum).rotation.y=Math.PI;
  for(let i=0;i<3;i++)box(Math.sin(i*TAU/3)*6,Math.cos(i*TAU/3)*6,-.3,6,4,1,['#cfa38a','#acc6b1','#e5d9ba'][i],washerDrum);
  sign(132,35,-449,37,10,'탈수 연구소','F · 양말 우주여행','#466c65','#e8dfbb').rotation.y=Math.PI;
  const pathGroup=new THREE.Group();scene.add(pathGroup);
  for(const [x,z] of [[59,-211],[59,-180],[59,-148],[42,-104],[23,-69],[6,-37]]){
    const ring=mesh(new THREE.TorusGeometry(2,.25,5,20),new THREE.MeshBasicMaterial({color:'#efd68d'}),x,-17.8,z,1,1,1,pathGroup);
    ring.rotation.x=Math.PI/2;
  }
  const leftFixtures=new Set(scene.children);
  box(-79,2,57,52,42,40,wood).castShadow=true;
  for(const x of [-91,-67]){box(x,1,35.9,23,37,1,'#a88660');box(x,9,35,7,1,1,chrome);}
  box(-79,25,57,58,5,45,porcelain).castShadow=true;
  sphere(-79,27.3,54,20,2.3,14,porcelain);sphere(-79,28,54,14,.55,10,'#718d89');
  cylinder(-79,33,69,1.2,13,chrome);const spout=cylinder(-79,39,65,1,9,chrome);spout.rotation.x=Math.PI/2;
  box(-79,69,77,54,62,3,wood);
  const mirrorCanvas=document.createElement('canvas');mirrorCanvas.width=mirrorCanvas.height=256;const mg=mirrorCanvas.getContext('2d'),grad=mg.createLinearGradient(0,0,256,256);
  grad.addColorStop(0,'#d8e2dc');grad.addColorStop(.5,'#b1c7c6');grad.addColorStop(1,'#819e9e');mg.fillStyle=grad;mg.fillRect(0,0,256,256);
  mg.fillStyle='#e7f0df77';mg.fillRect(16,10,38,220);mg.fillStyle='#94aead';mg.fillRect(125,130,115,126);mg.strokeStyle='#dee8df';mg.lineWidth=3;mg.strokeRect(125,130,115,126);
  const mt=new THREE.CanvasTexture(mirrorCanvas);mt.colorSpace=THREE.SRGBColorSpace;
  const mirror=mesh(new THREE.PlaneGeometry(49,57),new THREE.MeshBasicMaterial({map:mt}),-79,69,74.9);mirror.rotation.y=0;
  // Toiletries on the vanity.
  for(const [x,c,h] of [[-100,'#728d75',12],[-94,'#a7856f',9],[-60,'#c2d0ac',14]]){cylinder(x,29+h/2,55,2.1,h,c);cylinder(x,30+h,55,1.3,2,'#33494c');}
  cylinder(-60,32,66,3,8,porcelain);for(let i=0;i<3;i++){const brush=box(-62+i*2,40,66,1,15,1,['#708eac','#cb927d','#859d72'][i]);brush.rotation.z=(i-1)*.1;}
  // Shower cubicle with fluted glass and chrome plumbing.
  box(-76,-15,-52,58,5,63,porcelain);
  const glass=new THREE.MeshStandardMaterial({color:'#b4d9d0',transparent:true,opacity:.18,roughness:.25,depthWrite:false,side:THREE.DoubleSide});
  box(-47,34,-66,1,98,34,glass);box(-77,34,-21,60,98,1,glass);
  for(const z of [-83,-21])cylinder(-47,34,z,.7,100,chrome);
  cylinder(-105,27,-61,.8,81,chrome);
  const showerArm=cylinder(-99,66,-61,.75,12,chrome);showerArm.rotation.z=Math.PI/2;
  const showerHead=cylinder(-92,65,-61,5,1.2,chrome);showerHead.rotation.z=.2;
  box(-103,21,-59,2,6,10,chrome);
  for(const item of scene.children)if(!leftFixtures.has(item))item.position.x-=40;
  const showerDoor=new THREE.Group();scene.add(showerDoor);showerDoor.position.set(-87,-15,49);
  box(0,49,14,1,98,28,glass,showerDoor);
  for(const z of [0,28])cylinder(0,49,z,.7,98,chrome,showerDoor);
  for(const y of [1,97])box(0,y,14,1,1,28,chrome,showerDoor);
  box(2,43,23,1.4,12,1.4,chrome,showerDoor);
  const rightFixtures=new Set(scene.children);
  // Towel rail, bath mat, toilet roll holder and a small plant.
  const rail=cylinder(80,37,88,1,36,chrome);rail.rotation.z=Math.PI/2;
  for(const [x,c] of [[71,'#8ba59c'],[84,'#b98e78']]){box(x,22,86.5,12,30,2,c);for(let i=0;i<4;i++)box(x-4+i*2.6,21,85.35,.45,27,.2,material(c,.95));}
  box(52,-17.6,34,32,.8,54,'#708d83');for(let i=0;i<14;i++)box(52,-17.1,10+i*3.7,29,.12,.25,'#8da698');
  const holder=cylinder(44,13,68,.65,14,chrome);holder.rotation.z=Math.PI/2;
  const roll=cylinder(44,13,68,5,11,porcelain);roll.rotation.z=Math.PI/2;
  box(45,6,63.2,9,11,.3,'#dfe0d2');
  cylinder(79,-10,119,10,16,'#ae8060');
  for(let i=0;i<7;i++){const leaf=sphere(79+Math.sin(i*2.4)*8,5+i*3,119+Math.cos(i*2.4)*8,3,13,1.3,'#5e8069');leaf.rotation.z=Math.sin(i)*.7;}
  for(const item of scene.children)if(!rightFixtures.has(item))item.position.x+=40;
  const showerWater=new THREE.Group();scene.add(showerWater);
  const runningWaterMaterial=new THREE.MeshBasicMaterial({color:'#78cee6',transparent:true,opacity:.8});
  for(let i=0;i<22;i++)cylinder(-132+Math.sin(i*2.4)*4,18,-61+Math.cos(i*2.4)*4,.22,13,runningWaterMaterial,showerWater);
  const duck=new THREE.Group();scene.add(duck);duck.position.set(30,-11,228);
  sphere(0,0,0,6,4,7,'#e4c362',duck);sphere(0,4,-4,3.7,3.7,3.7,'#ecd273',duck);box(0,3,-7.6,4,1.7,3,'#ce8e43',duck);
  for(const x of [-1.7,1.7])sphere(x,5,-6.9,.45,.5,.35,'#253c3b',duck);
  // Sculpted porcelain bowl and raised seat: all fighting happens inside it.
  const profile=[[0,-18],[11,-18],[12,-9],[21,-3],[27,7],[28,10],[26,11],[23,8.7],[20,5],[0,4]];
  const bowl=new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),80),porcelain);
  bowl.position.z=-30;bowl.scale.z=1.68;bowl.receiveShadow=bowl.castShadow=true;scene.add(bowl);
  const seat=new THREE.Mesh(new THREE.TorusGeometry(1,.065,12,96),porcelain);seat.rotation.x=Math.PI/2;seat.scale.set(27,46,20);seat.position.set(0,11,-30);scene.add(seat);
  box(0,17,82,43,24,10,porcelain).castShadow=true;box(0,29.6,82,45,1.7,12,porcelain);
  box(15,24,76.4,5,1,1.5,chrome);
  const lid=sphere(0,48,88,26,32,2.3,porcelain);lid.castShadow=true;
  sign(0,23,76.75,14,5,'FLUSH','BATHROOM DEFENSE','#31514f','#e6ecd0');
  const waterTexture=tileTexture('#477c80','#4c8386','#679695',8);waterTexture.repeat.set(4,7);
  const water=new THREE.Mesh(new THREE.CircleGeometry(1,80),new THREE.MeshStandardMaterial({map:waterTexture,color:'#b1d2c5',roughness:.26,metalness:.12}));
  water.rotation.x=-Math.PI/2;water.scale.set(24,44,1);water.position.set(0,7,-30);water.receiveShadow=true;scene.add(water);
  // Arena cover and stairs use the same dimensions as the collision world.
  for(const b of arena){
    if(b.kind==='jumpPad'){
      const pad=box(b.x,b.y,b.z,b.w,b.h,b.d,'#487e6c');pad.castShadow=true;
      const ring=new THREE.Mesh(new THREE.TorusGeometry(1,.08,6,24),new THREE.MeshBasicMaterial({color:'#a9e6ad'}));ring.rotation.x=Math.PI/2;ring.position.set(b.x,b.top+.04,-b.z);scene.add(ring);
      const arrow=sign(b.x,b.top+.045,b.z,1.5,1.1,'↑','', '#426d60','#dfffaf');arrow.rotation.x=-Math.PI/2;arrow.rotation.y=0;
    }else{
      const color=b.kind==='stairs'?'#779b90':b.kind==='deck'?'#557970':b.h>2?'#466563':'#bcab80';
      const m=box(b.x,b.y,b.z,b.w,b.h,b.d,color);m.castShadow=true;
      box(b.x,b.top+.025,b.z,b.w*.96,.055,b.d*.96,b.kind==='cover'?'#b9c7a9':'#94b8a0');
      if(b.kind==='cover'&&b.h>1){sign(b.x,b.y,b.z-b.d/2-.015,b.w*.75,Math.min(1,b.h*.55),'SOAP','', '#cbbd91','#355958');}
    }
  }
  // Drain cap and subtle lane markings.
  const drain=cylinder(0,7.07,28,2.7,.1,chrome);
  for(let i=-2;i<=2;i++)box(i*.6,7.14,28,.16,.03,3.6,'#244747');
  for(const x of [-17,17])box(x,7.04,30,.07,.03,54,'#add0b5');
  const objective=new THREE.Group();scene.add(objective);
  const deepGroup=new THREE.Group();scene.add(deepGroup);
  const pipeMaterial=new THREE.MeshStandardMaterial({color:'#386166',roughness:.8,side:THREE.BackSide});
  const tunnel=new THREE.Mesh(new THREE.CylinderGeometry(30,30,94,48,1,true),pipeMaterial);tunnel.rotation.x=Math.PI/2;tunnel.position.set(0,26,-31);deepGroup.add(tunnel);
  box(0,6.5,31,43,1,94,'#53665e',deepGroup);box(0,7.015,31,3,.03,92,'#2e736c',deepGroup);
  for(const z of [-10,8,26,44,62]){
    const rim=mesh(new THREE.TorusGeometry(29.8,.55,8,48),material('#7a9681',.6,.25),0,26,z,1,1,1,deepGroup);
    for(const x of [-21,21])box(x,9,z,.3,.18,11,new THREE.MeshBasicMaterial({color:'#a9d99e'}),deepGroup);
  }
  box(0,25,78,61,62,2,'#304d50',deepGroup);box(0,25,-17,61,62,2,'#304d50',deepGroup);
  const exitPipe=mesh(new THREE.CircleGeometry(10,48),material('#101f24'),0,25,76.8,1,1,1,deepGroup);
  const exitRim=mesh(new THREE.TorusGeometry(10,.7,8,48),material('#bba67d'),0,25,76.4,1,1,1,deepGroup);
  const pipeSign=mesh(new THREE.PlaneGeometry(17,4),label('배수로 B-02','정비 통로 / 최종 세척 구역'),0,40,76,1,1,1,deepGroup);
  const pipeObstacles=new THREE.Group();deepGroup.add(pipeObstacles);let pipeBuilt=false;
  const objRing=new THREE.Mesh(new THREE.TorusGeometry(3.7,.08,6,64),new THREE.MeshBasicMaterial({color:'#d5df87'}));objRing.rotation.x=Math.PI/2;objective.add(objRing);
  const objBeacon=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,7,8),new THREE.MeshBasicMaterial({color:'#e4eab2',transparent:true,opacity:.5}));objBeacon.position.y=3.5;objective.add(objBeacon);

  // Batch static opaque geometry by material. Furniture costs only a few draw calls.
  function mergeStatic(){
    scene.updateMatrixWorld(true);
    const groups=new Map();
    for(const m of scene.children.filter(m=>m.isMesh&&!m.material.transparent&&!m.userData.dynamic)){
      const key=m.material.uuid+'/'+m.castShadow;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);
    }
    for(const list of groups.values()){
      if(list.length<2)continue;
      const positions=[],normals=[],uvs=[],indices=[];let offset=0;
      for(const m of list){
        const g=m.geometry.clone().applyMatrix4(m.matrixWorld),pos=g.getAttribute('position'),nor=g.getAttribute('normal'),uv=g.getAttribute('uv');
        positions.push(...pos.array);normals.push(...nor.array);
        if(uv)uvs.push(...uv.array);else for(let i=0;i<pos.count;i++)uvs.push(0,0);
        if(g.index)for(const i of g.index.array)indices.push(offset+i);else for(let i=0;i<pos.count;i++)indices.push(offset+i);
        offset+=pos.count;g.dispose();scene.remove(m);
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);
      const m=new THREE.Mesh(g,list[0].material);m.castShadow=list[0].castShadow;m.receiveShadow=true;scene.add(m);
    }
  }
  mergeStatic();
  const houseWorld=new THREE.Group();
  for(const child of [...scene.children])if(!child.isLight&&child!==key.target&&child!==deepGroup&&child!==objective)houseWorld.add(child);
  scene.add(houseWorld);
  const endingWorld=new THREE.Group();scene.add(endingWorld);
  box(0,-.5,0,55,1,55,'#657774',endingWorld);const endWater=cylinder(0,.1,0,5,.25,'#204f50',endingWorld);
  for(let i=0;i<20;i++){const a=i*TAU/20,b=box(Math.sin(a)*5.8,.3,Math.cos(a)*5.8,1.7,.7,1.1,'#afae97',endingWorld);b.rotation.y=-a;}
  const endPoop=new THREE.Group();endingWorld.add(endPoop);
  sphere(0,0,0,2.2,1.3,2,'#80543c',endPoop);sphere(.1,1.05,0,1.6,1.1,1.45,'#956347',endPoop);sphere(-.15,1.95,0,1,.8,.9,'#a16e4d',endPoop);sphere(.25,2.5,0,.45,.6,.45,'#ad7954',endPoop);
  const splash=new THREE.Group();endingWorld.add(splash);for(let i=0;i<18;i++)sphere(0,1,0,.19,.45,.19,'#a3d7bd',splash);
  const ripples=[];for(let i=0;i<3;i++){const m=new THREE.Mesh(new THREE.TorusGeometry(1,.035,5,40),new THREE.MeshBasicMaterial({color:'#acd7bf',transparent:true,opacity:.7}));m.rotation.x=Math.PI/2;m.position.y=.35;endingWorld.add(m);ripples.push(m);}
  // Reusable model geometry and a finite actor pool.
  function makePlunger(parent){
    const g=new THREE.Group();parent.add(g);
    cylinder(0,.14,0,.025,1.1,'#bd9964',g);sphere(0,.7,0,.035,.05,.035,'#cda879',g);
    const profile=[[.026,-.39],[.065,-.43],[.14,-.49],[.20,-.59],[.205,-.63],[.174,-.63],[.16,-.57],[.10,-.50],[.025,-.46]];
    const cup=new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),24),material('#a95746',.83));g.add(cup);
    const lip=new THREE.Mesh(new THREE.TorusGeometry(.19,.018,6,24),material('#c57859',.8));lip.rotation.x=Math.PI/2;lip.position.y=-.63;g.add(lip);
    cylinder(0,-.458,0,.024,.015,'#61392f',g);return g;
  }
  function actor(kind,friendly=false,boss=false,homeActor=false){
    const g=new THREE.Group();scene.add(g);
    const coat=material(friendly?'#8cc4b4':boss?'#705a68':kind==='cool'?'#738ba3':kind==='angry'?'#a86753':'#9b9977');
    const suit=material(friendly?'#e1e3cd':'#3f4e50'),boots=material('#273d3e'),skin=material(friendly?'#d7b994':'#bd9d7d');
    const torso=mesh(capsuleGeo,coat,0,0,0,.83,.60,.54,g);
    box(0,.03,-.32,.54,.62,.11,suit,g);box(0,.13,-.395,.30,.11,.035,friendly?'#b9f8bc':'#e9ae72',g);
    const head=sphere(0,.94,0,.36,.39,.33,skin,g);
    const helmet=sphere(0,1.13,.015,.41,.26,.38,coat,g);
    box(0,1.02,-.32,.46,.10,.035,'#2b4043',g);
    for(const x of [-.13,.13])sphere(x,1.035,-.347,.028,.025,.018,friendly?'#c6e1dc':'#f6cf84',g);
    const legs=[];
    for(const x of [-.23,.23]){
      const pivot=new THREE.Group();pivot.position.set(x,-.52,0);g.add(pivot);
      mesh(capsuleGeo,suit,0,-.39,0,.36,.38,.36,pivot);box(0,-.86,-.08,.4,.24,.60,boots,pivot);legs.push(pivot);
      mesh(capsuleGeo,coat,x*2.65,-.12,0,.31,.37,.31,g);
      sphere(x*2.4,-.48,-.26,.16,.17,.19,boots,g);
    }
    if(homeActor){const tool=makePlunger(g);tool.position.set(.58,-.6,.30);tool.scale.setScalar(1.5);tool.rotation.x=.22;}
    else{box(.24,-.31,-.52,.14,.16,.7,'#354346',g);const barrel=cylinder(.24,-.29,-1.04,.045,.45,chrome,g);barrel.rotation.x=Math.PI/2;box(.24,-.24,-.57,.09,.10,.17,'#57706b',g);}
    box(0,.02,.35,.56,.7,.26,coat,g);
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(.75,24),new THREE.MeshBasicMaterial({color:'#173e3b',transparent:true,opacity:.28,depthWrite:false}));shadow.rotation.x=-Math.PI/2;scene.add(shadow);
    let rotor=null;
    if(kind==='flyer'){rotor=new THREE.Group();rotor.position.y=1.8;g.add(rotor);box(0,0,0,2.4,.07,.18,'#5a7477',rotor);box(0,0,0,.18,.07,2.4,'#5a7477',rotor);cylinder(0,1.49,0,.08,.5,chrome,g);box(0,0,.4,.6,.9,.4,'#829c9f',g);}
    if(boss){for(const x of [-.58,.58])cylinder(x,.2,.23,.25,1.7,material('#ad8f58',.5,.2),g);sphere(0,1.23,0,.24,.17,.22,'#d8b16d',g);}
    const flash=new THREE.Mesh(new THREE.ConeGeometry(.12,.4,6),new THREE.MeshBasicMaterial({color:'#ffe4a3'}));flash.rotation.x=Math.PI/2;flash.position.set(.24,-.29,1.33);g.add(flash);flash.visible=false;
    const teamRing=new THREE.Mesh(new THREE.TorusGeometry(.72,.025,5,24),new THREE.MeshBasicMaterial({color:friendly?'#a8f3c5':'#e0b167',transparent:true,opacity:.6}));teamRing.rotation.x=Math.PI/2;teamRing.position.y=-1.43;g.add(teamRing);teamRing.visible=friendly;
    return{g,torso,coat,legs,rotor,shadow,flash};
  }
  function updateActor(id,t,s,friendly,remote=false){
    const modelKind=t.flyer?'flyer':t.type||'grin',tag=modelKind+friendly+!!t.boss;
    const actorKey=id+'/'+tag;let a=actors.get(actorKey);

    if(!a){a=actor(modelKind,friendly,t.boss);a.tag=tag;actors.set(actorKey,a);}
    a.used=true;a.g.visible=t.alive!==false&&t.hp>0;a.shadow.visible=a.g.visible;
    const scale=t.boss?2.55:1;a.g.scale.setScalar(scale);a.g.position.set(t.x,t.y,-t.z);
    const facing=t.facing??Math.atan2(s.camera.x-t.x,s.camera.z-t.z);a.g.rotation.y=Math.PI-facing;
    const walk=Math.sin(s.time*(t.slow>0?3.5:7)+(t.phase||0))*.25;
    a.legs[0].rotation.x=walk;a.legs[1].rotation.x=-walk;
    a.torso.material=t.flash>0?material('#f6e2b0'):a.coat;
    if(a.rotor)a.rotor.rotation.y=s.time*25;
    a.shadow.position.set(t.x,7.03,-t.z);a.shadow.scale.setScalar(scale*(t.flyer?.8:1));
    a.flash.visible=remote&&s.remoteFx.some(e=>e.owner===id&&e.effect==='shot'&&e.age<.10);
  }
  function prop(id,kind){let g=props.get(id);if(g)return g;g=new THREE.Group();scene.add(g);
    if(kind==='barrel'){cylinder(0,0,0,.60,1.8,'#a65f49',g);for(const y of [-.8,-.43,.43,.8])cylinder(0,y,0,.62,.10,chrome,g);box(0,0,-.61,.42,.52,.02,'#e4c283',g);}
    if(kind==='paper'){const m=cylinder(0,0,0,.42,.7,porcelain,g);m.rotation.z=Math.PI/2;const core=cylinder(.36,0,0,.16,.02,'#9a825a',g);core.rotation.z=Math.PI/2;box(.1,-.27,-.35,.55,.55,.025,'#f0ecd9',g);}
    if(kind==='heal'){box(0,0,0,.75,.6,.55,'#d8e1c6',g);box(0,0,-.28,.36,.10,.04,'#4a9b79',g);box(0,0,-.29,.1,.36,.04,'#4a9b79',g);}
    props.set(id,g);return g;
  }
  // A separate view-model pass gives solid weapons and gloved hands without wall clipping.
  vmScene.add(new THREE.HemisphereLight('#f4f7de','#425956',2.4));const vl=new THREE.DirectionalLight('#fff0d4',2.5);vl.position.set(1,3,2);vmScene.add(vl);
  const weaponRoot=new THREE.Group();vmScene.add(weaponRoot);
  function gun(sniper){
    const g=new THREE.Group();weaponRoot.add(g);
    box(0,0,0,.16,.15,.43,'#36464a',g);box(0,-.03,.31,.14,.13,.30,sniper?'#7c8162':'#465b52',g);
    box(0,-.16,.07,.09,.24,.11,'#243437',g).rotation.x=-.28;
    const magazine=box(.005,-.19,-.09,.09,.24,.15,'#394c4c',g);magazine.rotation.x=.15;
    box(0,.015,-.3,.14,.12,.32,sniper?'#818566':'#526761',g);
    const b=cylinder(0,.02,-.65,.025,sniper?.52:.34,chrome,g);b.rotation.x=Math.PI/2;
    for(let i=0;i<6;i++)box(0,.082,-.42+i*.055,.15,.012,.022,'#23363a',g);
    if(sniper){const scope=cylinder(0,.17,-.03,.075,.31,'#27373d',g);scope.rotation.x=Math.PI/2;const lens=sphere(0,.17,-.19,.058,.058,.012,'#75a7a6',g);}
    else{box(-.047,.145,-.23,.018,.115,.055,'#24383e',g);box(.047,.145,-.23,.018,.115,.055,'#24383e',g);box(0,.198,-.23,.11,.018,.055,'#24383e',g);}
    for(const [x,y,z,ang] of [[-.12,-.14,-.29,.9],[.11,-.29,.10,.45]]){
      const arm=mesh(capsuleGeo,'#748f7f',x,y-.10,z+.19,.14,.22,.14,g);arm.rotation.x=ang;
      sphere(x,y,z,.09,.10,.13,'#293c37',g);
    }
    return{g,magazine};
  }
  const rifle=gun(false),sniper=gun(true),plunger=new THREE.Group(),paper=new THREE.Group();weaponRoot.add(plunger,paper);
  const heldPlunger=makePlunger(plunger);heldPlunger.rotation.z=Math.PI;heldPlunger.rotation.x=-.4;
  sphere(.04,-.20,0,.1,.13,.1,'#344b3d',plunger);
  const rollView=cylinder(0,0,0,.15,.25,porcelain,paper);rollView.rotation.z=Math.PI/2;box(0,-.14,-.11,.21,.24,.012,'#efedda',paper);
  rifle.g.scale.z=-1;sniper.g.scale.z=-1;paper.scale.z=-1;
  const hero=actor('cool',true,false,true);
  const cape=box(0,-.15,.59,.9,1.5,.08,'#bb917d',hero.g);
  let quality='',lost=false,lightingScene='';
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;});
  canvas.addEventListener('webglcontextrestored',()=>{lost=false;renderer.shadowMap.needsUpdate=true;});
  function render(s){
    if(lost)return false;
    if(quality!==s.quality){quality=s.quality;renderer.setSize(quality==='low'?1008:1440,quality==='low'?630:900,false);renderer.shadowMap.enabled=quality!=='low';renderer.shadowMap.needsUpdate=true;}
    tvScreen.material=s.homeFun?.tv?tvOn:tvOff;
    showerDoor.rotation.y+=( (s.homeFun?.showerDoor?-Math.PI/2:0)-showerDoor.rotation.y)*.18;
    cabinetDoor.rotation.y+=( (s.homeFun?.cabinet?-1.8:0)-cabinetDoor.rotation.y)*.16;
    secretDuck.rotation.y=Math.PI+(s.homeFun?.cabinet?Math.sin(s.time*4)*.25:0);
    if(s.homeFun?.washer>0)washerDrum.rotation.z=s.time*12;else washerDrum.rotation.z=0;
    showerWater.visible=!!s.homeFun?.shower;showerWater.children.forEach((m,i)=>m.position.y=60-((s.time*68+i*3.1)%70));
    duck.rotation.y=Math.sin(s.time*2)*.05;duck.position.y=-11+Math.sin(s.time*8)*Math.min(2,s.homeFun?.duck||0);
    cape.visible=!!s.homeFun?.towel;cape.rotation.x=.15+Math.sin(s.time*5)*.08;
    const menu=s.mode==='menu',home=!menu&&s.entry?.phase!=='combat',e=s.entry,ending=s.mode==='ending',deep=!home&&!menu&&s.gameMode!=='duel'&&s.layoutId===1;
    deepGroup.visible=deep&&!ending;houseWorld.visible=!deep&&!ending;endingWorld.visible=ending;
    const lightScene=ending?'ending':deep?'pipe':'home';if(lightingScene!==lightScene){lightingScene=lightScene;renderer.shadowMap.needsUpdate=true;}
    scene.fog.near=deep?75:180;scene.fog.far=deep?160:500;
    key.intensity=deep?1.3:home||menu?2:2.9;
    ambient.color.set(home||menu?'#ffe9d0':'#e8f2e5');ambient.groundColor.set(home||menu?'#75766a':'#677b73');ambient.intensity=home||menu?1.65:2;
    homeLight.position.set(25,72,home||menu?355:265);homeLight.distance=home||menu?300:210;homeLight.intensity=home||menu?2600:1400;
    sunPatch.visible=home||menu;
    if(deep&&!pipeBuilt){
      for(const b of s.arena){box(b.x,b.y,b.z,b.w,b.h,b.d,b.kind==='jumpPad'?'#64ba91':b.kind==='stairs'?'#819e90':'#587572',pipeObstacles);box(b.x,b.top+.03,b.z,b.w*.96,.06,b.d*.96,b.kind==='jumpPad'?'#c6df93':'#b1b69a',pipeObstacles);}
      pipeBuilt=true;
    }
    const homeFirstPerson=home&&e.phase==='walk';
    pathGroup.visible=homeFirstPerson;hero.g.visible=home&&!homeFirstPerson;hero.shadow.visible=home&&!homeFirstPerson;
    if(home){
      const p=e.phase==='dive'?(e.progress||0):0,k=p*p*(3-2*p);
      const sc=16*(1-k)+k;
      const x=e.phase==='walk'?e.x:(e.from.x*(1-k)+e.destination.x*k);
      const z=e.phase==='walk'?e.z:(e.from.z*(1-k)+e.destination.z*k);
      const feet=(e.feet??-18)*(1-k)+(e.destination.y-2)*k+Math.sin(p*Math.PI)*52+(e.jump||0)*(1-k);
      hero.g.position.set(x,feet+1.45*sc,-z);hero.g.scale.setScalar(sc);hero.g.rotation.set(-Math.sin(p*Math.PI)*.75,Math.PI-e.yaw,0);
      hero.legs[0].rotation.x=Math.sin(e.walk)*.4*(1-k);hero.legs[1].rotation.x=-hero.legs[0].rotation.x;
      hero.shadow.position.set(x,-17.8,-z);hero.shadow.scale.setScalar(19*(1-k)+1);hero.shadow.visible=!homeFirstPerson&&p<.25;
      const orbitPitch=clamp(e.pitch||0,-.65,1.05),behind=86*Math.cos(orbitPitch),camY=feet+(46+Math.sin(orbitPitch)*64)*(1-k)+2*k;
      const fromCam=new THREE.Vector3(e.x-Math.sin(e.yaw)*behind,camY,-e.z+Math.cos(e.yaw)*behind);
      if(e.phase==='walk'){fromCam.x-=Math.cos(e.yaw)*24;fromCam.z-=Math.sin(e.yaw)*24;}
      const endCam=new THREE.Vector3(e.destination.x,e.destination.y,-e.destination.z);
      camera.position.copy(fromCam).lerp(endCam,k);
      const startLook=new THREE.Vector3(x,feet+24*(1-k)+2*k,-z);
      const endLook=endCam.clone().add(new THREE.Vector3(Math.sin(e.spawnYaw)*10,0,-Math.cos(e.spawnYaw)*10));
      camera.lookAt(startLook.lerp(endLook,k));camera.fov=62+(Math.sin(p*Math.PI)*12);
      // Exploration uses the same eye-anchored yaw/pitch camera as combat.
      // Keep the third-person shrink/jump camera only for the toilet entry cinematic.
      if(homeFirstPerson){
        const eyeY=feet+(e.eyeHeight??43),cp=Math.cos(e.pitch);
        camera.position.set(x,eyeY,-z);
        camera.lookAt(x+Math.sin(e.yaw)*cp,eyeY+Math.sin(e.pitch),-z-Math.cos(e.yaw)*cp);
        camera.fov=2*Math.atan(450/850)*180/Math.PI;
      }
    }
    if(menu){const a=Math.sin(s.now*.00006)*.1;camera.position.set(43+Math.sin(a)*8,43,88);camera.lookAt(0,13,-27);camera.fov=55;}
    else if(!home){camera.position.set(s.camera.x,s.camera.y,-s.camera.z);camera.lookAt(s.camera.x+Math.sin(s.yaw)*Math.cos(s.pitch),s.camera.y+Math.sin(s.pitch),-s.camera.z-Math.cos(s.yaw)*Math.cos(s.pitch));camera.fov=2*Math.atan(450/s.focal)*180/Math.PI;}
    if(s.mapTransition>0){const p=1-s.mapTransition/3.2;camera.position.set(Math.sin(p*TAU)*3,9+(1-p)*28,12*(1-p));camera.lookAt(0,10,-45);camera.fov=72;}
    if(ending){
      camera.position.set(0,35,7);camera.lookAt(0,0,0);camera.fov=58;
      const fall=clamp(s.finale/2.6,0,1),age=Math.max(0,s.finale-2.6);endPoop.position.y=25*(1-fall*fall);endPoop.rotation.y=fall*2;endPoop.visible=s.finale<2.65;
      splash.visible=age>0&&age<1.3;splash.children.forEach((m,i)=>{const a=i*TAU/18,r=1+age*5;m.position.set(Math.sin(a)*r,.5+age*8-age*age*7,Math.cos(a)*r);});
      ripples.forEach((m,i)=>{m.visible=age>i*.2;const size=clamp((age-i*.2)*3+.2,.2,4.6);m.scale.setScalar(size);m.material.opacity=Math.max(0,.7-age*.25);});
    }
    camera.updateProjectionMatrix();
    for(const a of actors.values())a.used=false;
    s.targets.forEach((t,i)=>updateActor('enemy'+i,t,s,false));
    s.pilots.forEach(p=>{const pos=p.pos||p.state;updateActor(p.playerId,{...p.state,x:pos.x,y:pos.y-.55,z:pos.z,alive:p.state.hp>0,type:'cool',facing:p.state.yaw},s,s.gameMode!=='duel',true);});
    if(home){
      for(const a of actors.values()){a.g.visible=false;a.shadow.visible=false;}
      for(const p of s.pilots)if(p.state.entry){
        const pe=p.state.entry;updateActor(p.playerId,{...p.state,x:pe.x,y:-18+23.2+(pe.jump||0),z:pe.z,type:'cool',facing:pe.yaw},s,true,true);
        const a=actors.get(p.playerId+'/cooltruefalse');if(a){a.g.scale.setScalar(16);a.shadow.position.set(pe.x,-17.8,-pe.z);a.shadow.scale.setScalar(19);}
      }
    }
    for(const a of actors.values())if(!a.used){a.g.visible=false;a.shadow.visible=false;}
    for(const g of props.values())g.visible=false;
    s.barrels.forEach((b,i)=>{const g=prop('barrel'+i,'barrel');g.visible=b.alive;g.position.set(b.x,b.y,-b.z);});
    s.papers.forEach((b,i)=>{const g=prop('paper'+i,'paper');g.visible=!b.taken;g.position.set(b.x,b.y+Math.sin(s.time*2+i)*.06,-b.z);g.rotation.y=s.time*.5;});
    s.heals.forEach((b,i)=>{const g=prop('heal'+i,'heal');g.visible=true;g.position.set(b.x,b.y,-b.z);g.rotation.y=s.time*.6;});
    objective.visible=!!s.mission?.capture&&!menu&&!home&&!ending&&s.gameMode!=='duel';
    if(objective.visible){const m=s.mission;objective.position.set(m.point.x,m.point.y,-m.point.z);objRing.material.color.set(m.progress>=m.required?'#9be2b6':'#e3d682');objBeacon.scale.y=m.progress>=m.required?.1:1;}
    if(ending){for(const a of actors.values()){a.g.visible=false;a.shadow.visible=false;}for(const g of props.values())g.visible=false;}
    renderer.info.autoReset=false;renderer.info.reset();renderer.autoClear=true;renderer.render(scene,camera);
    if(homeFirstPerson){
      rifle.g.visible=false;sniper.g.visible=false;paper.visible=false;plunger.visible=true;
      weaponRoot.scale.setScalar(.62);
      weaponRoot.position.set(.34,-.31+Math.sin(e.walk)*.004,-.85);weaponRoot.rotation.set(.12,0,-.20);
      renderer.autoClear=false;renderer.clearDepth();renderer.render(vmScene,vmCam);
    }else if(!menu&&!home&&!ending&&!s.mapTransition&&!(s.weapon==='sniper'&&s.aim>.85)){
      weaponRoot.scale.setScalar(1);
      rifle.g.visible=s.weapon==='rifle'&&!s.melee&&!s.paper;sniper.g.visible=s.weapon==='sniper'&&!s.melee&&!s.paper;plunger.visible=s.melee>0;paper.visible=s.paper;
      const bob=Math.sin(s.walkPhase)*.008,phase=s.reload>0?Math.sin(clamp(s.reload/s.reloadMax,0,1)*Math.PI):0;
      weaponRoot.position.set(.27*(1-s.aim),-.25+(.102*s.aim)+bob*(1-s.aim),-.69+s.recoil*.045);
      weaponRoot.rotation.set(phase*.38,-.10*(1-s.aim),-.05*(1-s.aim)-phase*.7);
      rifle.magazine.position.y=sniper.magazine.position.y=-.19-phase*.30;
      if(s.melee){const swing=Math.sin((1-s.melee/.42)*Math.PI);weaponRoot.position.x=.28-swing*.18;weaponRoot.position.z=-.6-swing*.5;weaponRoot.rotation.z=-.3+swing*.5;}
      renderer.autoClear=false;renderer.clearDepth();renderer.render(vmScene,vmCam);
    }
    document.documentElement.dataset.renderer='webgl';return true;
  }
  return{render,info:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,actors:actors.size,geometries:renderer.info.memory.geometries})};
};
