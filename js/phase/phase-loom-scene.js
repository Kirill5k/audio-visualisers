import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const COLUMNS = 16384;
const TRACES = 7;
const PCM_SIZE = 32768;
// Every vertex follows actual PCM. There are no parametric loops or ornamental
// meshes: changing harmonics and stereo relationships make the visible forms.
const vertexShader = /* glsl */`
  uniform sampler2D uPcm;
  uniform float uStart, uSamples, uDelay, uCalibration, uGain, uPersistence;
  uniform float uProjection, uFrom, uTo, uMorph;
  attribute vec3 trace;
  varying float vAcross, vLight, vColor;
  vec3 pcm(float sampleIndex) {
    float index = clamp(sampleIndex,0.0,32766.0);
    float a = floor(index), b = a + 1.0;
    vec2 uvA = vec2((mod(a,8192.0)+.5)/8192.0,(floor(a/8192.0)+.5)/4.0);
    vec2 uvB = vec2((mod(b,8192.0)+.5)/8192.0,(floor(b/8192.0)+.5)/4.0);
    return mix(texture2D(uPcm,uvA).rgb,texture2D(uPcm,uvB).rgb,fract(index));
  }
  vec3 sectionProjection(float shape,float rail,float side,float mid,float delayed) {
    if(shape<.5)return vec3((mid-delayed)*.8,(mid+delayed)*.65,side*.25);
    if(shape<1.5)return vec3(rail*.63+sign(mid)*.18,mid*.85,side*.3+rail*.24);
    if(shape<2.5)return vec3(mid*1.15,rail*.48+mid*rail*.32,side*.22+abs(rail)*.18);
    if(shape<3.5)return vec3(rail*.59,mid,side*.26);
    return vec3(rail*.80*(.16+.78*abs(mid)),mid,side*.20+rail*mid*.18);
  }
  vec3 point(float u, float age) {
    float index = uStart + u*uSamples - age*uSamples*.50*uPersistence;
    vec3 current = pcm(index)*uCalibration;
    vec3 lag = pcm(index-uDelay)*uCalibration;
    vec3 lag2 = pcm(index-uDelay*2.0)*uCalibration;
    float side = (current.x-current.y)*.85;
    float mid = current.z;
    float delayed = lag.z;
    vec3 p;
    if(uProjection<.5) {
      // Three voltage regions in the delayed waveform make a phase-sliced
      // portrait. The audio chooses every rail visit and connecting stroke.
      float rail = smoothstep(.15,.19,delayed)-smoothstep(.15,.19,-delayed);
      p = mix(sectionProjection(uFrom,rail,side,mid,delayed),sectionProjection(uTo,rail,side,mid,delayed),uMorph);
      p.x+=side*.10+(mid-delayed)*.025;
      p.z+=lag2.z*.12;
    } else if(uProjection<1.5) {
      // Rotate stereo XY by45 degrees: correlated audio forms a vertical line.
      p = vec3((current.x-current.y)*.7071,(current.x+current.y)*.7071,0.0);
    } else if(uProjection<2.5) {
      p = vec3((mid-delayed)*.8,(mid+delayed)*.65,side*.25);
    } else {
      p = vec3(side+(mid-delayed)*.6,mid,delayed*.8);
    }
    p *= uGain;
    // A gentle limiter preserves the waveform while keeping loud peaks framed.
    p = p*inversesqrt(vec3(1.0)+p*p*.13);
    return p*2.15;
  }
  void main() {
    float u=trace.x, age=trace.y;
    vec3 p=point(u,age);
    vec3 next=point(min(u+.0001,1.0),age);
    if(u>.9998)next=p+(p-point(u-.0001,age));
    vec4 clip=projectionMatrix*modelViewMatrix*vec4(p,1.0);
    vec4 after=projectionMatrix*modelViewMatrix*vec4(next,1.0);
    vec2 dir=after.xy/after.w-clip.xy/clip.w;
    dir.x*=projectionMatrix[1][1]/projectionMatrix[0][0];
    dir=normalize(dir+vec2(.0000001,0.0));
    vec2 normal=vec2(-dir.y,dir.x);
    normal.x*=projectionMatrix[0][0]/projectionMatrix[1][1];
    clip.xy+=normal*trace.z*(1.30/1080.0)*clip.w;
    gl_Position=clip;
    vAcross=trace.z;
    float history=exp(-age*.65/max(.08,uPersistence));
    // Beam dwell lights slow passages more strongly than rapid crossings,
    // independent of the current section's orientation.
    float speed=length(after.xy/after.w-clip.xy/clip.w)*900.0;
    vLight=history*(.35+.65*u)*(.16+.84/(1.0+speed));
    vColor=clamp(length(p)*.26,0.0,1.0);
  }
`;
const fragmentShader = /* glsl */`
  uniform vec3 uColorA,uColorB;
  uniform float uBrightness;
  varying float vAcross,vLight,vColor;
  void main(){
    float edge=1.0-smoothstep(.2,1.0,abs(vAcross));
    vec3 color=mix(uColorB,uColorA,vColor*.70);
    gl_FragColor=vec4(color*uBrightness*2.00,edge*vLight*.76);
  }
`;

export function createPhaseLoomScene(container,settings){
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:true});
  renderer.setClearColor(0x000000,1); renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  container.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,16/9,.1,100);
  camera.position.set(0,0,10.2);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enablePan=false;controls.enableDamping=false;controls.minDistance=5.5;controls.maxDistance=18;
  const traces=new Float32Array(TRACES*COLUMNS*2*3),positions=new Float32Array(traces.length);
  const indices=new Uint32Array(TRACES*(COLUMNS-1)*6);
  let offset=0,index=0;
  for(let row=0;row<TRACES;row++)for(let column=0;column<COLUMNS;column++){
    for(let side=0;side<2;side++){traces[offset++]=column/(COLUMNS-1);traces[offset++]=TRACES-1-row;traces[offset++]=side?1:-1;}
    if(column<COLUMNS-1){const a=(row*COLUMNS+column)*2;indices[index++]=a;indices[index++]=a+1;indices[index++]=a+2;indices[index++]=a+2;indices[index++]=a+1;indices[index++]=a+3;}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('trace',new THREE.BufferAttribute(traces,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));
  const pcmData=new Float32Array(PCM_SIZE*4);
  const pcmTexture=new THREE.DataTexture(pcmData,8192,4,THREE.RGBAFormat,THREE.FloatType);
  pcmTexture.minFilter=pcmTexture.magFilter=THREE.NearestFilter;pcmTexture.needsUpdate=true;
  const uniforms={uPcm:{value:pcmTexture},uStart:{value:PCM_SIZE-4096},uSamples:{value:2048},uDelay:{value:62},
    uCalibration:{value:1},uGain:{value:1.2},uPersistence:{value:.55},uProjection:{value:0},uFrom:{value:3},uTo:{value:3},uMorph:{value:0},
    uBrightness:{value:1},uColorA:{value:new THREE.Color('#7023ff')},uColorB:{value:new THREE.Color('#be83ff')}};
  const material=new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms,transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
  const composer=new EffectComposer(renderer,new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false}));
  composer.addPass(new RenderPass(scene,camera));
  const bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.3,.18,.55);composer.addPass(bloom);
  // Compress the RGB triplet together, preserving its violet hue even where
  // hundreds of strokes overlap. Per-channel filmic clipping turned it white.
  const output=new ShaderPass({uniforms:{tDiffuse:{value:null}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform sampler2D tDiffuse;varying vec2 vUv;void main(){vec3 c=texture2D(tDiffuse,vUv).rgb*1.65;float peak=max(c.r,max(c.g,c.b));c=c/(1.0+peak);gl_FragColor=vec4(pow(max(c,vec3(0.0)),vec3(1.0/2.2)),1.0);}'});
  output.material.toneMapped=false;composer.addPass(output);
  let width=1920,height=1080,pixelRatio=1,view='front',lastData=null;
  const palettes={phosphor:['#681aff','#cfa1ff'],ice:['#246bff','#b7dfff'],aurora:['#12bb82','#adffdd'],ember:['#f73a20','#ffd5a2']};
  function setView(next){view=next;camera.position.copy(next==='top'?new THREE.Vector3(0,6,8):next==='oblique'?new THREE.Vector3(4.5,1.7,9):new THREE.Vector3(0,0,10.2)).normalize().multiplyScalar(10.2);camera.lookAt(0,0,0);controls.target.set(0,0,0);controls.update();}
  function render(data){
    lastData=data;
    let levelPeak=0;
    if(data?.waveformLeft&&data?.waveformRight){
      const l=data.waveformLeft,r=data.waveformRight,selected=data.scopeChannel===1?r:l;
      for(let i=0;i<PCM_SIZE;i++){
        const j=i*4;pcmData[j]=l[i];pcmData[j+1]=r[i];pcmData[j+2]=selected[i];
        levelPeak=Math.max(levelPeak,Math.abs(selected[i]));
      }
      pcmTexture.needsUpdate=true;
    }else if(!data?.features?.rms){pcmData.fill(0);pcmTexture.needsUpdate=true;}
    const samples=data?.scopeSamples??2048;
    uniforms.uStart.value=(data?.scopeStart??PCM_SIZE-4096)+samples*.5;
    uniforms.uSamples.value=samples*.5;
    uniforms.uDelay.value=data?.scopeDelaySamples??62;
    // A causal peak window bounds every displayed trace and steadies framing.
    // Current transients remain free to expand within that envelope.
    uniforms.uCalibration.value=Math.min(8,.82/Math.max(.10,levelPeak));
    uniforms.uGain.value=settings.gain??1.2;
    uniforms.uPersistence.value=settings.persistence??.55;
    uniforms.uProjection.value=({stereo:1,phase:2,spatial:3})[settings.shape]??0;
    uniforms.uFrom.value=data?.shapeFrom??3;
    uniforms.uTo.value=data?.shapeTo??3;
    uniforms.uMorph.value=data?.morph??1;
    uniforms.uBrightness.value=settings.brightness??1;
    const colors=palettes[settings.palette]||palettes.phosphor;uniforms.uColorA.value.set(colors[0]);uniforms.uColorB.value.set(colors[1]);
    bloom.strength=(settings.glow??.2)*1.5;
    const time=data?.time||0;
    mesh.rotation.set(settings.motion?Math.sin(time*.041)*.12:0,settings.motion?Math.sin(time*.031)*.20:0,0);
    mesh.scale.setScalar((settings.zoom||1)*1.18);composer.render();
  }
  function resize(w,h,ratio=1){width=w;height=h;pixelRatio=ratio;renderer.setPixelRatio(ratio);renderer.setSize(w,h,false);composer.setPixelRatio(ratio);composer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}
  controls.addEventListener('change',()=>{if(lastData)render(lastData);});
  return{canvas:renderer.domElement,render,resize,setView,gpuFinish:()=>renderer.getContext().finish(),
    getInfo:()=>({columns:COLUMNS,traces:TRACES,vertices:TRACES*COLUMNS*2,source:'stereo PCM + delayed PCM',width,height,pixelRatio,view}),
    dispose(){controls.dispose();geometry.dispose();material.dispose();pcmTexture.dispose();bloom.dispose();output.dispose();composer.dispose();renderer.dispose();renderer.domElement.remove();}};
}
