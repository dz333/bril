#!/usr/bin/env node
import * as bril from './bril';
import {readStdin} from './util';
import { sys } from 'typescript';

export interface BasicBlock {
  name: bril.Ident | null;
  idx: number;
  instrs: bril.Instruction[]
}

export interface CFGNode {
  name: string,
  block: BasicBlock,
  next: CFGNode[]
}

const entryLabel = "__entry__";
const exitLabel = "__exit__";

function isTerminator(instr: bril.Instruction) {
  if ('op' in instr) {
    return instr.op in ["br", "jmp", "ret"];
  }
  return false; 
}

function createBasicBlocks(prog: bril.Program) {
  let blocks: BasicBlock[]= []
  let idx = 0
  let cur_block: BasicBlock = {name: entryLabel, instrs: [], idx: idx}
  for (let func of prog.functions) {
    if (func.name === "main") {
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

function createCFG(blocks: BasicBlock[]) {
  let nodeList:CFGNode[] = [] 
  for (let block of blocks) {
    let name = (block.name == null) ? "block" + block.idx : block.name
    let node:CFGNode = {name: name, block: block, next: []}
    nodeList.push(node)
  }
  let exit:BasicBlock = {name: null, idx: nodeList.length, instrs:[]}
  nodeList.push({name:exitLabel, block: exit, next:[]})

  for (let node of nodeList) {
    let successors:bril.Ident[] = []
    for (let instr of node.block.instrs) {
      for (let s of getSuccessors(instr)) {
        successors.push(s)
      }
    }
    for (let n of getNamedNodes(successors, nodeList)) {
      node.next.push(n)
    }
    if (successors.length == 0 && node.block.idx + 1 < nodeList.length) {
        node.next.push(nodeList[node.block.idx + 1])
     }
  }
  return nodeList;
}

function printCFG(fname: string, cfg:CFGNode[]) {
  let result = "digraph " + fname + " {\n"

  for (let n of cfg) {
    result += "  " + n.name.split(".").join("_") + ";\n"
  }

  for (let n of cfg) {
    for (let succ of n.next) {
      result += "  " + n.name.split(".").join("_") + " -> " + succ.name.split(".").join("_") + ";\n"
    }
  }
  result += "}\n"
  process.stdout.write(result);
  return;
}

async function main() {
  // Get the Bril filename.
  let prog = JSON.parse(await readStdin()) as bril.Program;
  let blocks = createBasicBlocks(prog)
  if (sys.args.length > 0) {
    process.stdout.write(
      JSON.stringify(blocks, undefined, 2)
    );
  } else {
    printCFG("main", createCFG(blocks))
  }
}
process.on('unhandledRejection', e => { throw e });

main()