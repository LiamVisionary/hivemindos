import * as THREE from "three";

const DEFAULT_ALONG = 24;
const DEFAULT_AROUND = 12;

type BrainFiberTubeOptions = {
  along?: number;
  around?: number;
  shell?: number;
  terminalGlow?: number;
};

const VERTEX = /* glsl */ `
  attribute float aAlong;
  attribute float aStrength;
  uniform float uShell;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vTerminal;
  varying float vStrength;
  void main() {
    vColor = color;
    vStrength = aStrength;
    vTerminal = pow(abs(aAlong * 2.0 - 1.0), 1.8);
    float shellProfile = mix(0.62, 1.0, vTerminal);
    vec4 world = modelMatrix * vec4(position + normal * uShell * shellProfile, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uLight;
  uniform float uOpacity;
  uniform float uGlowLayer;
  uniform float uTerminalGlow;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vTerminal;
  varying float vStrength;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float body = pow(facing, 0.62);
    float rim = pow(1.0 - facing, 1.7);
    float terminalLight = vTerminal * uTerminalGlow;
    vec3 emissive = mix(vColor * 0.92, vec3(0.72, 0.9, 1.0), 0.1 + body * 0.2 + terminalLight * 0.08);
    vec3 lightBody = mix(vColor * 0.98, vColor * 1.22, body);
    vec3 coreColor = mix(emissive, lightBody, uLight);
    float membrane = 0.48 + body * 0.52;
    float darkCoreAlpha = uOpacity * membrane * (0.86 + terminalLight * 0.3);
    float lightCoreAlpha = min(1.0, uOpacity * (1.06 + terminalLight * 0.08));
    float coreAlpha = mix(darkCoreAlpha, lightCoreAlpha, uLight);
    vec3 glowColor = mix(vColor, vec3(0.45, 0.72, 1.0), 0.18);
    float glowAlpha = uOpacity * (0.025 + rim * 0.1) * (0.7 + terminalLight * 0.48) * (1.0 - uLight);
    vec3 col = mix(coreColor, glowColor, uGlowLayer) * mix(1.0, 1.48, 1.0 - uLight);
    float alpha = mix(coreAlpha, glowAlpha, uGlowLayer) * vStrength;
    gl_FragColor = vec4(col, alpha);
  }
`;

export class BrainFiberTubes {
  readonly mesh = new THREE.Group();
  private readonly along: number;
  private readonly around: number;
  private readonly color: THREE.BufferAttribute;
  private readonly coreMaterial: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private readonly glowMaterial: THREE.ShaderMaterial;
  private readonly normal: THREE.BufferAttribute;
  private readonly position: THREE.BufferAttribute;
  private readonly side = new THREE.Vector3();
  private readonly strength: THREE.BufferAttribute;
  private readonly tangent = new THREE.Vector3();
  private readonly binormal = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly reference = new THREE.Vector3();
  private readonly surface = new THREE.Vector3();

  constructor(private readonly count: number, light: boolean, options: BrainFiberTubeOptions = {}) {
    this.along = options.along ?? DEFAULT_ALONG;
    this.around = options.around ?? DEFAULT_AROUND;
    const verticesPerTube = (this.along + 1) * this.around;
    const geometry = new THREE.BufferGeometry();
    this.geometry = geometry;
    this.position = new THREE.BufferAttribute(new Float32Array(count * verticesPerTube * 3), 3);
    this.normal = new THREE.BufferAttribute(new Float32Array(count * verticesPerTube * 3), 3);
    this.color = new THREE.BufferAttribute(new Float32Array(count * verticesPerTube * 3), 3);
    this.strength = new THREE.BufferAttribute(new Float32Array(count * verticesPerTube).fill(1), 1);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.normal.setUsage(THREE.DynamicDrawUsage);
    this.color.setUsage(THREE.DynamicDrawUsage);
    this.strength.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", this.position);
    geometry.setAttribute("normal", this.normal);
    geometry.setAttribute("color", this.color);
    geometry.setAttribute("aStrength", this.strength);
    const along = new Float32Array(count * verticesPerTube);
    for (let tube = 0; tube < count; tube += 1) {
      const base = tube * verticesPerTube;
      for (let ring = 0; ring <= this.along; ring += 1) {
        along.fill(ring / this.along, base + ring * this.around, base + (ring + 1) * this.around);
      }
    }
    geometry.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
    const indices = new Uint32Array(count * this.along * this.around * 6);
    let cursor = 0;
    for (let tube = 0; tube < count; tube += 1) {
      const base = tube * verticesPerTube;
      for (let ring = 0; ring < this.along; ring += 1) {
        for (let side = 0; side < this.around; side += 1) {
          const nextSide = (side + 1) % this.around;
          const a = base + ring * this.around + side;
          const b = base + (ring + 1) * this.around + side;
          const c = base + (ring + 1) * this.around + nextSide;
          const d = base + ring * this.around + nextSide;
          indices[cursor++] = a; indices[cursor++] = b; indices[cursor++] = d;
          indices[cursor++] = b; indices[cursor++] = c; indices[cursor++] = d;
        }
      }
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.coreMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uGlowLayer: { value: 0 },
        uLight: { value: light ? 1 : 0 },
        uOpacity: { value: light ? 0.62 : 0.36 },
        uShell: { value: 0 },
        uTerminalGlow: { value: options.terminalGlow ?? 0.55 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      vertexColors: true,
      transparent: true,
      depthWrite: light,
      // These are closed radial surfaces. Drawing the back faces as well as
      // the front faces doubles additive energy and makes silhouettes pop as
      // the camera rotates across facets.
      side: THREE.FrontSide,
      blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.glowMaterial = this.coreMaterial.clone();
    this.glowMaterial.uniforms.uGlowLayer.value = 1;
    this.glowMaterial.uniforms.uShell.value = options.shell ?? 0.95;
    this.glowMaterial.visible = !light;
    const glowMesh = new THREE.Mesh(geometry, this.glowMaterial);
    glowMesh.frustumCulled = false;
    glowMesh.renderOrder = -1;
    const coreMesh = new THREE.Mesh(geometry, this.coreMaterial);
    coreMesh.frustumCulled = false;
    coreMesh.renderOrder = 0;
    this.mesh.add(glowMesh, coreMesh);
  }

  setTheme(light: boolean) {
    this.coreMaterial.uniforms.uLight.value = light ? 1 : 0;
    this.coreMaterial.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.coreMaterial.depthWrite = light;
    this.coreMaterial.needsUpdate = true;
    this.glowMaterial.uniforms.uLight.value = light ? 1 : 0;
    this.glowMaterial.blending = THREE.AdditiveBlending;
    this.glowMaterial.depthWrite = false;
    this.glowMaterial.needsUpdate = true;
    this.glowMaterial.visible = !light;
  }

  setOpacity(opacity: number) {
    this.coreMaterial.uniforms.uOpacity.value = opacity;
    this.glowMaterial.uniforms.uOpacity.value = opacity;
  }

  setColors(slot: number, start: THREE.Color, end: THREE.Color) {
    const base = slot * (this.along + 1) * this.around;
    for (let ring = 0; ring <= this.along; ring += 1) {
      const t = ring / this.along;
      const r = start.r + (end.r - start.r) * t;
      const g = start.g + (end.g - start.g) * t;
      const b = start.b + (end.b - start.b) * t;
      for (let side = 0; side < this.around; side += 1) this.color.setXYZ(base + ring * this.around + side, r, g, b);
    }
  }

  setStrength(slot: number, strength: number) {
    const base = slot * (this.along + 1) * this.around;
    for (let vertex = 0; vertex < (this.along + 1) * this.around; vertex += 1) {
      this.strength.setX(base + vertex, strength);
    }
  }

  setCurve(
    slot: number,
    start: THREE.Vector3,
    control: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    startRadius: number,
    endRadius: number,
  ) {
    if (slot < 0 || slot >= this.count) return;
    const base = slot * (this.along + 1) * this.around;
    for (let ring = 0; ring <= this.along; ring += 1) {
      const t = ring / this.along;
      const inv = 1 - t;
      this.point.set(
        inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
        inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y,
        inv * inv * start.z + 2 * inv * t * control.z + t * t * end.z,
      );
      this.tangent.copy(control).sub(start).multiplyScalar(2 * inv).addScaledVector(this.surface.copy(end).sub(control), 2 * t).normalize();
      if (ring === 0) {
        if (slot % 3 === 0) this.reference.set(0, 1, 0);
        else if (slot % 3 === 1) this.reference.set(1, 0, 0);
        else this.reference.set(0, 0, 1);
        if (Math.abs(this.reference.dot(this.tangent)) > 0.96) this.reference.set(this.reference.y, this.reference.z, this.reference.x);
        this.side.crossVectors(this.tangent, this.reference).normalize();
      } else {
        // Parallel-transport the previous ring's frame instead of selecting a
        // fresh world axis. This prevents sudden cross-section flips.
        this.side.addScaledVector(this.tangent, -this.side.dot(this.tangent));
        if (this.side.lengthSq() < 0.000001) this.side.crossVectors(this.tangent, this.reference);
        this.side.normalize();
      }
      this.binormal.crossVectors(this.tangent, this.side).normalize();
      // Neural processes flare organically where they merge into each soma,
      // then taper through the inter-cell span instead of reading as wire.
      const smoothStart = Math.min(1, t / 0.24);
      const smoothEnd = Math.min(1, (1 - t) / 0.24);
      const startBlend = 1 - smoothStart * smoothStart * (3 - 2 * smoothStart);
      const endBlend = 1 - smoothEnd * smoothEnd * (3 - 2 * smoothEnd);
      const middleRadius = radius * (0.9 + 0.08 * Math.sin(Math.PI * t * 3 + slot * 1.71));
      const localRadius = middleRadius
        + (startRadius - middleRadius) * startBlend
        + (endRadius - middleRadius) * endBlend;
      for (let side = 0; side < this.around; side += 1) {
        const angle = (side / this.around) * Math.PI * 2;
        this.surface.copy(this.side).multiplyScalar(Math.cos(angle)).addScaledVector(this.binormal, Math.sin(angle));
        const membrane = 1 + Math.sin(angle * 2 + slot * 2.37 + t * 8.0) * 0.055;
        const at = base + ring * this.around + side;
        this.position.setXYZ(
          at,
          this.point.x + this.surface.x * localRadius * membrane,
          this.point.y + this.surface.y * localRadius * membrane,
          this.point.z + this.surface.z * localRadius * membrane,
        );
        this.normal.setXYZ(at, this.surface.x, this.surface.y, this.surface.z);
      }
    }
  }

  commitGeometry() {
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
  }

  commitColors() {
    this.color.needsUpdate = true;
    this.strength.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.coreMaterial.dispose();
    this.glowMaterial.dispose();
  }
}
