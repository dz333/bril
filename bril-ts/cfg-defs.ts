#!/usr/bin/env node
import * as bril from './bril';
import { HashMap, HashSet, HasEquals, stringHashCode } from 'prelude-ts';
/* A Basic Block which may not yet have a label associated with it */
export interface AnonymousBlock {
    name: bril.Ident | null;
    idx: number;
    instrs: (bril.Instruction)[]
}
/* A named basic block, the name serves as the basic block's label */
export interface BasicBlock extends AnonymousBlock {
    name: bril.Ident;
}
  
/* A basic block whose last instruction is termInstr,
 * the block may contain no other terminating instructions */
export interface TerminatingBlock extends BasicBlock {
    termInstr: bril.EffectOperation;
}

/* A shorthand for the data structure mapping cfg nodes to their dominators */
export type DominatorMap = HashMap<CFGNode, HashSet<CFGNode>>;
  
/**
 * A CFGNode represents a node in the control flow
 * graph and keeps track of predecessors, successors
 * and instructions to execute at that point in the graph.
 * It keeps track of termination instructions separately
 * to ease updating edges in this graph.
 * 
 * This class has equals() and hashCode() methods which allow
 * it to be used by the prelude-ts HashSet and HashMap libraries.
 * 
 * The notion of equality for CFGNodes is purely by name, we assume
 * two CFGNodes with the same name must be references to the same object.
 * _Never_ create two different CFGNodes with the same name.
 */
export class CFGNode implements HasEquals {
  
    readonly name: string;
    private instrs: bril.Instruction[];
    private termInstr: bril.EffectOperation;
    private successors: HashSet<CFGNode>;
    private predecessors: HashSet<CFGNode>;
  
    constructor(name: string, block:TerminatingBlock, successors:HashSet<CFGNode>, predecessors:HashSet<CFGNode>) {
      this.name = name;
      this.instrs = block.instrs;
      this.termInstr = block.termInstr;
      this.successors = successors;
      this.predecessors = predecessors;
    }
  
    /**
     * Sets the successors of this node and
     * sets this node's terminating instruction to be a branch.
     * Also updates the other nodes to add `this` as a predecessor.
     * @param trueBr The node to which control transfers if the branch condition is true
     * @param falseBr The node to which control transfers if the branch condition is false
     * @param cond The branch condition argument
     */
    setSuccessors(trueBr:CFGNode, falseBr:CFGNode, cond:string) {
      this.successors = HashSet.of(trueBr, falseBr);
      trueBr.predecessors = trueBr.predecessors.add(this);
      falseBr.predecessors = falseBr.predecessors.add(this);
      let termInstr:bril.EffectOperation = { op: "br", args: [cond, trueBr.name, falseBr.name] }
      this.termInstr = termInstr;
    }
  
    /**
     * Sets the successor of this node and
     * sets this node's terminating instruction to be a jump.
     * Also sets the predecessor of the target to `this`.
     * @param n The target of the jmp instruction.
     */
    setSuccessor(n:CFGNode) {
      this.successors = HashSet.of(n);
      n.predecessors = n.predecessors.add(this);
      let termInstr:bril.EffectOperation = { op: "jmp", args: [n.name] }
      this.termInstr = termInstr;
    }
  
    setInstrs(instrs:bril.Instruction[]) {
      this.instrs = instrs;
    }

    private addEdgeTo(other:CFGNode) {
      this.successors = this.successors.add(other);
      other.predecessors = other.predecessors.add(this);
    }
  
    private removeEdgeTo(other:CFGNode) {
      this.successors = this.successors.remove(other);
      other.predecessors = other.predecessors.remove(this);
    }
  
    /**
     * Replace an edge in the CFG from `this` to `originalSucc`
     * with an edge to `newSucc`. If no such edge exists this is a no-op.
     * This also updates the arguments of the terminating instruction
     * to reflect the new destination label
     * @param originalSucc The original successor of this node.
     * @param newSucc The new successor to this node replacing `originalSucc`.
     */
    replaceEdgeTo(originalSucc:CFGNode, newSucc:CFGNode) {
      if (!this.successors.contains(originalSucc)) { return };
      this.removeEdgeTo(originalSucc);
      this.addEdgeTo(newSucc);
      this.termInstr.args.forEach((a, idx) => {
        if (a == originalSucc.name) {
          this.termInstr.args[idx] = newSucc.name;
        }
      })
    }
  
    /**
     * This removes all edges to and from
     * this nodes, thereby removing it from the graph
     * completely.
     */
    delete() {
      for (let s of this.successors) {
        this.removeEdgeTo(s);
      }
      for (let s of this.predecessors) {
        s.removeEdgeTo(this);
      }
    }
  
    getSuccessors() {
      return this.successors;
    }
  
    getPredecessors() {
      return this.predecessors;
    }
  
    getInstrs() {
      return this.instrs;
    }
  
    getTerminator() {
      return this.termInstr;
    }
    
    /**
     * Equality only checks names,
     * our CFG implementation assumes that no
     * two nodes have the same name (i.e. label).
     */
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