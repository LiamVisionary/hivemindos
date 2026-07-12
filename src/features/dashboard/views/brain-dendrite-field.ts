import * as THREE from "three";
import { BrainFiberTubes } from "./brain-fiber-tubes";
import { clamp, hashUnit } from "./brain-synapse-gpu";

export type DendriteNode = {
  activity: number;
  id: string;
  radius: number;
  weight: number;
  x: number;
  y: number;
  z: number;
};

type DendriteBranch = {
  nodeIndex: number;
  seed: number;
  slot: number;
};

export class BrainDendriteField {
  readonly mesh = new THREE.Group();
  private readonly branches: DendriteBranch[];
  private readonly control = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly endColor = new THREE.Color();
  private readonly glowColor = new THREE.Color(0.08, 0.42, 1);
  private readonly normal = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly start = new THREE.Vector3();
  private readonly startColor = new THREE.Color();
  private readonly terminalControl = new THREE.Vector3();
  private readonly terminalDirection = new THREE.Vector3();
  private readonly terminalEnd = new THREE.Vector3();
  private readonly terminals: BrainFiberTubes;
  private readonly trunks: BrainFiberTubes;
  private readonly twigControl = new THREE.Vector3();
  private readonly twigDirection = new THREE.Vector3();
  private readonly twigEnd = new THREE.Vector3();
  private readonly twigs: BrainFiberTubes;

  constructor(nodes: DendriteNode[], light: boolean) {
    this.branches = [];
    nodes.forEach((node, nodeIndex) => {
      const count = 7 + Math.round(clamp(node.weight, 0, 1) * 5);
      for (let branch = 0; branch < count; branch += 1) {
        this.branches.push({
          nodeIndex,
          seed: hashUnit(`${node.id}:dendrite:${branch}`, 211),
          slot: this.branches.length,
        });
      }
    });
    this.trunks = new BrainFiberTubes(this.branches.length, light, { along: 17, around: 6, shell: 0.36, terminalGlow: 0.18 });
    this.twigs = new BrainFiberTubes(this.branches.length * 3, light, { along: 11, around: 5, shell: 0.22, terminalGlow: 0.08 });
    this.terminals = new BrainFiberTubes(this.branches.length * 6, light, { along: 8, around: 4, shell: 0.12, terminalGlow: 0.04 });
    this.mesh.add(this.trunks.mesh, this.twigs.mesh, this.terminals.mesh);
    this.mesh.renderOrder = -0.5;
    this.setOpacity(light ? 0.14 : 0.64);
  }

  setTheme(light: boolean) {
    this.trunks.setTheme(light);
    this.twigs.setTheme(light);
    this.terminals.setTheme(light);
    this.setOpacity(light ? 0.14 : 0.64);
  }

  setOpacity(opacity: number) {
    this.trunks.setOpacity(opacity * 0.82);
    this.twigs.setOpacity(opacity * 0.88);
    this.terminals.setOpacity(opacity * 0.84);
  }

  updateColors(nodes: DendriteNode[], nodeTints: Float32Array) {
    for (const branch of this.branches) {
      const node = nodes[branch.nodeIndex];
      if (!node) continue;
      this.startColor.setRGB(
        nodeTints[branch.nodeIndex * 3],
        nodeTints[branch.nodeIndex * 3 + 1],
        nodeTints[branch.nodeIndex * 3 + 2],
      );
      this.endColor.copy(this.startColor).lerp(this.glowColor, 0.34 + branch.seed * 0.2);
      this.trunks.setColors(branch.slot, this.startColor, this.endColor);
      this.trunks.setStrength(branch.slot, 0.58 + node.activity * 0.22 + node.weight * 0.16);
      for (let fork = 0; fork < 3; fork += 1) {
        const twigSlot = branch.slot * 3 + fork;
        this.twigs.setColors(twigSlot, this.endColor, this.startColor);
        this.twigs.setStrength(twigSlot, 0.44 + node.activity * 0.16 + node.weight * 0.12);
        for (let child = 0; child < 2; child += 1) {
          const terminalSlot = twigSlot * 2 + child;
          this.terminals.setColors(terminalSlot, this.endColor, this.startColor);
          this.terminals.setStrength(terminalSlot, 0.4 + node.activity * 0.14 + node.weight * 0.1);
        }
      }
    }
    this.trunks.commitColors();
    this.twigs.commitColors();
    this.terminals.commitColors();
  }

  updateGeometry(nodes: DendriteNode[]) {
    for (const branch of this.branches) {
      const node = nodes[branch.nodeIndex];
      if (!node) continue;
      const azimuth = hashUnit(`${node.id}:${branch.slot}`, 223) * Math.PI * 2;
      const vertical = hashUnit(`${node.id}:${branch.slot}`, 227) * 2 - 1;
      const ring = Math.sqrt(Math.max(0.0001, 1 - vertical * vertical));
      this.direction.set(Math.cos(azimuth) * ring, vertical, Math.sin(azimuth) * ring).normalize();
      const length = 20 + branch.seed * 22 + node.weight * 18
        + node.radius * (0.65 + node.weight * 0.8);
      this.start.set(node.x, node.y, node.z);
      this.end.copy(this.start).addScaledVector(this.direction, length);
      this.side.set(
        hashUnit(`${node.id}:${branch.slot}`, 229) - 0.5,
        hashUnit(`${node.id}:${branch.slot}`, 233) - 0.5,
        hashUnit(`${node.id}:${branch.slot}`, 239) - 0.5,
      ).cross(this.direction);
      if (this.side.lengthSq() < 0.0001) this.side.set(0, 1, 0).cross(this.direction);
      this.side.normalize();
      this.normal.crossVectors(this.direction, this.side).normalize();
      const bendSign = branch.seed < 0.5 ? -1 : 1;
      const sideBend = bendSign * length * (0.18 + Math.abs(branch.seed - 0.5) * 0.46);
      const normalSeed = hashUnit(`${node.id}:${branch.slot}`, 257);
      const normalSign = normalSeed < 0.5 ? -1 : 1;
      const normalBend = normalSign * length * (0.08 + Math.abs(normalSeed - 0.5) * 0.32);
      this.control.copy(this.start)
        .addScaledVector(this.direction, length * (0.48 + branch.seed * 0.12))
        .addScaledVector(this.side, sideBend)
        .addScaledVector(this.normal, normalBend);
      const trunkRadius = 0.68 + node.weight * 0.72;
      this.trunks.setCurve(
        branch.slot,
        this.start,
        this.control,
        this.end,
        trunkRadius,
        clamp(node.radius * 0.38, 1.2, 3.2),
        0.22,
      );
      for (let fork = 0; fork < 3; fork += 1) {
        const twigSeed = hashUnit(`${node.id}:${branch.slot}:twig:${fork}`, 241);
        const forkAngle = (fork / 3) * Math.PI * 2 + twigSeed * 0.8;
        const twigLength = length * (0.52 + twigSeed * 0.24);
        this.twigDirection.copy(this.direction).multiplyScalar(0.62)
          .addScaledVector(this.side, Math.cos(forkAngle) * (0.68 + twigSeed * 0.28))
          .addScaledVector(this.normal, Math.sin(forkAngle) * (0.68 + twigSeed * 0.28))
          .normalize();
        this.twigEnd.copy(this.end).addScaledVector(this.twigDirection, twigLength);
        this.twigControl.copy(this.end)
          .addScaledVector(this.twigDirection, twigLength * 0.52)
          .addScaledVector(this.side, Math.cos(forkAngle) * twigLength * 0.1)
          .addScaledVector(this.normal, Math.sin(forkAngle) * twigLength * 0.1);
        const twigSlot = branch.slot * 3 + fork;
        this.twigs.setCurve(
          twigSlot,
          this.end,
          this.twigControl,
          this.twigEnd,
          0.28 + twigSeed * 0.16,
          0.52 + node.weight * 0.18,
          0.1,
        );
        for (let child = 0; child < 2; child += 1) {
          const terminalSeed = hashUnit(`${node.id}:${branch.slot}:terminal:${fork}:${child}`, 251);
          const sign = child === 0 ? -1 : 1;
          const terminalLength = twigLength * (0.46 + terminalSeed * 0.24);
          this.terminalDirection.copy(this.twigDirection).multiplyScalar(0.72)
            .addScaledVector(this.side, sign * (0.34 + terminalSeed * 0.22))
            .addScaledVector(this.normal, (terminalSeed - 0.5) * 0.42)
            .normalize();
          this.terminalEnd.copy(this.twigEnd).addScaledVector(this.terminalDirection, terminalLength);
          this.terminalControl.copy(this.twigEnd)
            .addScaledVector(this.terminalDirection, terminalLength * 0.52)
            .addScaledVector(this.side, sign * terminalLength * 0.08);
          this.terminals.setCurve(
            twigSlot * 2 + child,
            this.twigEnd,
            this.terminalControl,
            this.terminalEnd,
            0.11 + terminalSeed * 0.07,
            0.22,
            0.022,
          );
        }
      }
    }
    this.trunks.commitGeometry();
    this.twigs.commitGeometry();
    this.terminals.commitGeometry();
  }

  dispose() {
    this.trunks.dispose();
    this.twigs.dispose();
    this.terminals.dispose();
  }
}
