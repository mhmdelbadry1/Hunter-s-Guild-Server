import React, { useEffect, useRef } from "react";
import * as THREE from "three";

const HeroBanner = () => {
  const containerRef = useRef(null);
  // Use refs for mutable variables to avoid re-initialization issues in useEffect
  const requestRef = useRef();
  const uniformsRef = useRef({});

  useEffect(() => {
    if (!containerRef.current) return;

    let camera, scene, renderer;
    let uniforms;
    const container = containerRef.current;

    // Mouse state
    let newmouse = { x: 0, y: 0 };

    // Texture loader
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");

    // Initialize Scene
    function init(texture) {
      camera = new THREE.Camera();
      camera.position.z = 1;

      scene = new THREE.Scene();

      const geometry = new THREE.PlaneGeometry(2, 2);

      // Render Targets for feedback loop
      const w = container.clientWidth;
      const h = container.clientHeight;
      const textureFraction = 1;

      let rtTexture = new THREE.WebGLRenderTarget(
        w * textureFraction,
        h * textureFraction,
      );
      let rtTexture2 = new THREE.WebGLRenderTarget(
        w * textureFraction,
        h * textureFraction,
      );

      uniforms = {
        u_time: { type: "f", value: 1.0 },
        u_resolution: { type: "v2", value: new THREE.Vector2() },
        u_noise: { type: "t", value: texture },
        u_buffer: { type: "t", value: rtTexture.texture },
        u_mouse: { type: "v3", value: new THREE.Vector3() },
        u_frame: { type: "i", value: -1 },
        u_renderpass: { type: "b", value: false },
      };

      // Store uniforms in ref to access in render loop
      uniformsRef.current = { uniforms, rtTexture, rtTexture2 };

      // Shader Code
      const vertexShader = `
                void main() {
                    gl_Position = vec4( position, 1.0 );
                }
            `;

      const fragmentShader = `
                precision highp float;
                
                uniform vec2 u_resolution;
                uniform vec4 u_mouse;
                uniform float u_time;
                uniform sampler2D u_noise;
                uniform sampler2D u_buffer;
                uniform bool u_renderpass;
                uniform int u_frame;

                #define PI 3.141592653589793
                #define TAU 6.283185307179586

                const float multiplier = 25.5;
                const float zoomSpeed = 3.;
                const int layers = 5;

                mat2 rotate2d(float _angle){
                    return mat2(cos(_angle),sin(_angle),
                                -sin(_angle),cos(_angle));
                }

                vec2 hash2(vec2 p) {
                    vec2 o = texture2D( u_noise, (p+0.5)/256.0, -15.0 ).xy;
                    return o;
                }

                // BRIGHTER MINECRAFT PALETTE
                vec3 getMinecraftColor(vec2 z) {
                    float angle = atan(z.y, z.x);
                    float dist = length(z);
                    
                    // Brighter Emerald Green and Gold
                    vec3 emerald = vec3(0.3, 1.0, 0.5); 
                    vec3 gold = vec3(1.0, 0.8, 0.2);
                    
                    float mixFactor = 0.5 + 0.5 * sin(angle * 3.0 + dist * 5.0 + u_time);
                    return mix(emerald, gold, mixFactor);
                }

                vec3 render(vec2 uv, float scale) {
                    vec2 id = floor(uv);
                    vec2 subuv = fract(uv);
                    vec2 rand = hash2(id);
                    float bokeh = abs(scale) * 1.;

                    float particle = 0.;

                    if(length(rand) > 1.3) {
                        vec2 pos = subuv-.5;
                        float field = length(pos);
                        particle = smoothstep(.7, 0., field);
                        particle += smoothstep(.2, 0.2 * bokeh, field);
                    }
                    return vec3(particle * 2.);
                }

                vec3 renderLayer(int layer, int layers, vec2 uv, inout float opacity) {
                    vec2 _uv = uv;
                    float scale = mod((u_time + zoomSpeed / float(layers) * float(layer)) / zoomSpeed, -1.);
                    uv *= 20.; 
                    uv *= scale*scale; 
                    uv = rotate2d(u_time / 10.) * uv; 
                    uv += vec2(25. + sin(u_time*.1)*.2) * float(layer); 

                    vec3 pass = render(uv * multiplier, scale) * .2; 

                    opacity = 1. + scale;
                    float _opacity = opacity;
                    float endOpacity = smoothstep(0., 0.4, scale * -1.);
                    opacity += endOpacity;

                    return pass * _opacity * endOpacity;
                }

                void main() {
                    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.y, u_resolution.x);
                    vec2 texCoord = gl_FragCoord.xy / u_resolution.xy;

                    vec4 fragcolour = vec4(0.0, 0.0, 0.0, 1.0);

                    if(u_renderpass == true) {
                        // Feedback loop
                        if(u_frame > 5) {
                            fragcolour = texture2D(u_buffer, texCoord) * 6.;
                        }
                        uv *= rotate2d(u_time*.5);

                        float opacity = 1.;
                        float opacity_sum = 1.;

                        for(int i = 1; i <= layers; i++) {
                             vec3 layerVal = renderLayer(i, layers, uv, opacity);
                             // Use the custom color function
                             vec3 color = getMinecraftColor(uv * 2.0);
                             fragcolour += clamp(vec4(layerVal * color, 1.) * 5., 0., 5.);
                             opacity_sum += opacity;
                        }

                        fragcolour *= 1./opacity_sum;
                    } else {
                        fragcolour = texture2D(u_buffer, texCoord) * 5.;
                    }

                    gl_FragColor = fragcolour;
                }
            `;

      const material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
      });
      material.extensions.derivatives = true;

      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      try {
        // Check WebGL support first
        const canvas = document.createElement("canvas");
        const gl =
          canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
        if (!gl) {
          console.warn("WebGL not supported, skipping particle effects");
          return;
        }

        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: false,
          powerPreference: "low-power",
          failIfMajorPerformanceCaveat: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Limit pixel ratio for performance
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.domElement.style.position = "absolute";
        renderer.domElement.style.top = "0";
        renderer.domElement.style.left = "0";
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.pointerEvents = "none";
        container.appendChild(renderer.domElement);
      } catch (error) {
        console.warn("WebGL initialization failed:", error);
        return; // Exit gracefully if WebGL fails
      }

      // Initial resize
      onWindowResize();
    }

    // Generate Procedural Noise Texture
    function createNoiseTexture() {
      const size = 256;
      const data = new Uint8Array(size * size * 4);
      for (let i = 0; i < size * size * 4; i++) {
        data[i] = Math.random() * 255;
      }
      const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      return texture;
    }

    // Initialize immediately with generated texture
    const noiseTex = createNoiseTexture();
    init(noiseTex);
    animate();

    function onWindowResize() {
      if (!renderer || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      uniforms.u_resolution.value.x = w; // renderer.domElement.width;
      uniforms.u_resolution.value.y = h; // renderer.domElement.height;
      uniforms.u_frame.value = 0;

      // Re-init render targets on resize
      const { rtTexture, rtTexture2 } = uniformsRef.current;
      if (rtTexture) rtTexture.dispose();
      if (rtTexture2) rtTexture2.dispose();

      uniformsRef.current.rtTexture = new THREE.WebGLRenderTarget(w, h);
      uniformsRef.current.rtTexture2 = new THREE.WebGLRenderTarget(w, h);
    }

    // Listeners
    window.addEventListener("resize", onWindowResize, false);

    const onPointerMove = (e) => {
      const ratio = window.innerHeight / window.innerWidth;
      if (window.innerHeight > window.innerWidth) {
        newmouse.x = (e.pageX - window.innerWidth / 2) / window.innerWidth;
        newmouse.y =
          ((e.pageY - window.innerHeight / 2) / window.innerHeight) *
          -1 *
          ratio;
      } else {
        newmouse.x =
          (e.pageX - window.innerWidth / 2) / window.innerWidth / ratio;
        newmouse.y =
          ((e.pageY - window.innerHeight / 2) / window.innerHeight) * -1;
      }
    };
    document.addEventListener("pointermove", onPointerMove);

    function renderTexture() {
      const { uniforms, rtTexture, rtTexture2 } = uniformsRef.current;
      if (!uniforms) return; // Not ready

      // Ping-pong rendering
      // Save original resolution state
      const odims = uniforms.u_resolution.value.clone();

      uniforms.u_buffer.value = rtTexture2.texture;
      uniforms.u_renderpass.value = true;

      // Swap refs
      window.rtTexture = rtTexture; // debug

      renderer.setRenderTarget(rtTexture);
      renderer.render(scene, camera);

      // Return to screen buffer
      renderer.setRenderTarget(null);

      // Swap buffers in ref
      let temp = rtTexture;
      uniformsRef.current.rtTexture = rtTexture2;
      uniformsRef.current.rtTexture2 = temp;

      // Prepare for final render to screen
      uniforms.u_buffer.value = uniformsRef.current.rtTexture.texture; // use the new 'front' buffer
      uniforms.u_renderpass.value = false;
    }

    function animate(time) {
      if (!scene || !camera || !renderer) return;

      requestRef.current = requestAnimationFrame(animate);

      const { uniforms } = uniformsRef.current;
      if (uniforms) {
        uniforms.u_frame.value++;
        uniforms.u_mouse.value.x +=
          (newmouse.x - uniforms.u_mouse.value.x) * (1 / 8);
        uniforms.u_mouse.value.y +=
          (newmouse.y - uniforms.u_mouse.value.y) * (1 / 8);
        uniforms.u_time.value = performance.now() * 0.0005;
      }

      // First pass: render effect to texture
      renderTexture();

      // Second pass: render texture to screen
      renderer.render(scene, camera);
    }

    return () => {
      window.removeEventListener("resize", onWindowResize);
      document.removeEventListener("pointermove", onPointerMove);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (renderer) {
        renderer.dispose();
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      id="hero-canvas-container"
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        overflow: "hidden",
        background: "transparent",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
};

export default HeroBanner;
