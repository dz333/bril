#!/usr/bin/env node
import * as bril from './bril';
import { HashMap, HashSet, HasEquals, stringHashCode, Option } from 'prelude-ts';

export interface BasicBlock {
  name: bril.Ident | null;
  idx: number;
  instrs: bril.Instruction[]
}

export type DominatorMap = HashMap<CFGNode, HashSet<CFGNode>>;

export class CFGNode implements HasEquals {

  name: string;
  block: BasicBlock;
  successors: CFGNode[];
  predecessors: CFGNode[];

  constructor(name: string, block:BasicBlock, successors: CFGNode[], predecessors: CFGNode[]) {
    this.name = name;
    this.block = block;
    this.successors = successors;
    this.predecessors = predecessors;
  }

  equals(other: CFGNode): boolean {
    return this.name === other.name;
  }

  hashCode(): number {
    return stringHashCode(this.name);
  }
  
  toString(): string {
    return this.name;
  }
}
export interface Edge {
  from: CFGNode;
  to: CFGNode;
}

export const entryLabel = "__entry__";
export const exitLabel = "__exit__";

function isTerminator(instr: bril.Instruction) {
  if ('op' in instr) {
    return instr.op in ["br", "jmp", "ret"];
  }
  return false; 
}

export function createBasicBlocks(fname: string, prog: bril.Program) {
  let blocks: BasicBlock[]= []
  let idx = 0
  let cur_block: BasicBlock = {name: entryLabel, instrs: [], idx: idx}
  for (let func of prog.functions) {
    if (func.name === fname) {
      for (let instr of func.instrs) {
        if ('label' in instr) {
          blocks.push(cur_block)
          idx += 1
          cur_block = { name: instr.label, instrs: [], idx: idx}
        } else if (isTerminator(instr)) {
          cur_block.instrs.push(instr)
          blocks.push(cur_block)
          idx += 1
          cur_block = { name: null, instrs: [], idx: idx }
        } else {
          cur_block.instrs.push(instr)
        }
      }
      if (cur_block.instrs.length > 0 || cur_block.name !== null) {
        blocks.push(cur_block)
      }
    }
  }
  return blocks;
}

function getSuccessors(instr: bril.Instruction): bril.Ident[] {
  if ('op' in instr) {
    switch(instr.op) {
      case "ret": {
        return [exitLabel]
      }
      case "br": {
        return [instr.args[1], instr.args[2]];
      }
      case "jmp": {
        return [instr.args[0]];
      }
    }
  }
  return [];
}

function getNamedNodes(names: bril.Ident[], nodes: CFGNode[]): CFGNode[] {
  let result = []
  for (let n of nodes) {
    if (names.includes(n.name)) {
      result.push(n)
    }
  }
  return result;
}

export function createFunctionCFG(fname: string, prog:bril.Program) {
  let blocks = createBasicBlocks(fname, prog);
  return createCFG(blocks);
}

export function createCFG(blocks: BasicBlock[]) {
  let nodeList:CFGNode[] = [] 
  for (let block of blocks) {
    let name = (block.name == null) ? "block" + block.idx : block.name
    let node:CFGNode = new CFGNode(name, block , [], []);
    nodeList.push(node)
  }
  let exit:BasicBlock = {name: null, idx: nodeList.length, instrs:[]}
  nodeList.push(new CFGNode(exitLabel, exit, [], []));

  for (let node of nodeList) {
    let successors:bril.Ident[] = []
    for (let instr of node.block.instrs) {
      for (let s of getSuccessors(instr)) {
        successors.push(s)
      }
    }
    for (let n of getNamedNodes(successors, nodeList)) {
      node.successors.push(n)
      n.predecessors.push(node)
    }
    if (successors.length == 0 && node.block.idx + 1 < nodeList.length) {
        let nextBlock = nodeList[node.block.idx + 1]
        node.successors.push(nextBlock)
        nextBlock.predecessors.push(node);
     }
  }
  return nodeList;
}

export function getNamedNode(name: string, cfg:CFGNode[]): CFGNode | null {
  let nodes = getNamedNodes([name], cfg)
  if (nodes.length > 0) {
    return nodes[0]
  } else {
    return null;
  }
}

export function printCFG(fname: string, cfg:CFGNode[], doms: Option<DominatorMap>) {
  let result = "digraph " + fname + " {\n"

  for (let n of cfg) {
    result += "  " + n.name.split(".").join("_") + ";\n"
  }

  for (let n of cfg) {
    for (let succ of n.successors) {
      let style = "solid"
      if (doms.isSome() && isBackEdge(n, succ, doms.get())) {
        style = "dashed"
      }
      result += "  " + n.name.split(".").join("_") + " -> " + succ.name.split(".").join("_") + " [style = " + style + "];\n"
    }
  }
  for (let n of cfg) {
    for (let pred of n.predecessors) {
      result += "  " + n.name.split(".").join("_") + " -> " + pred.name.split(".").join("_") + " [color = blue];\n"
    }
  }
  if (doms.isSome()) {
    for (let n of cfg) {
      for (let dom of doms.get().get(n).getOrThrow()) {
        result += " " + n.name.split(".").join("_") + " -> " + dom.name.split(".").join("_") + " [color = red];\n"
      }
    }
  }
  result += "}\n"
  process.stdout.write(result);
  return;
}

export function postorder(root:CFGNode):CFGNode[] {
  let result:CFGNode[] = [];
  postorderHelper(root, HashSet.empty(), result);
  return result;
}

function postorderHelper(root:CFGNode, explored: HashSet<CFGNode>, result:CFGNode[]) {
  if (explored.contains(root)) {
      return explored;
  } else {
      explored = explored.add(root);
      for (let s of root.successors) {
          explored = postorderHelper(s, explored, result);
      }
      result.push(root);
      return explored;
  }
}

export function getDominators(root:CFGNode) {
  return getDominatorsHelper(postorder(root).reverse());
}

function getDominatorsHelper(blocks:CFGNode[]): DominatorMap {
  let result:DominatorMap = HashMap.empty();
  for (let b of blocks) {
    result = result.put(b, HashSet.ofIterable(blocks));
  }
  let changed = true;
  while(changed) {
    changed = false;
    for (let b of blocks) {
      let doms = HashSet.ofIterable(blocks);
      if (b.predecessors.length == 0) {
        doms = HashSet.empty()
      } else {
        for (let p of b.predecessors) {
          doms = doms.intersect(result.get(p).getOrThrow());
        }
      }
      doms = doms.add(b);
      if (!doms.equals(result.get(b).getOrThrow())) {
        changed = true;
      }
      result = result.put(b, doms);
    }
  }
  return result;
}

function isBackEdge(from: CFGNode, to: CFGNode, doms:DominatorMap) {
  return doms.get(from).getOrThrow().contains(to);
}

function getBackEdges(nodes: CFGNode[], doms:DominatorMap) {
  let result:Edge[] = [];
  for (let n of nodes) {
    let nDoms = doms.get(n).getOrThrow();
    for (let succ of n.successors) {
      if (nDoms.contains(succ)) {
        result.push( { from: n, to: succ} );
      }
    }
  }
  return result;
}