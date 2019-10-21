#!/usr/bin/env node
import * as bril from './bril';
import { Heap, Key } from './heap';
import {readStdin, unreachable} from './util';

const argCounts: {[key in bril.OpCode]: number | null} = {
  add: 2,
  mul: 2,
  sub: 2,
  div: 2,
  id: 1,
  lt: 2,
  le: 2,
  gt: 2,
  ge: 2,
  eq: 2,
  not: 1,
  and: 2,
  or: 2,
  print: null,  // Any number of arguments.
  br: 3,
  jmp: 1,
  ret: 0,
  nop: 0,
  alloc: 1,
  free: 1,
  store: 2,
  load: 1,
  ptradd: 2
};

type Pointer = {
  loc: Key;
  type: bril.Type;
}

type Value = boolean | Pointer | BigInt;
type Env = Map<bril.Ident, Value>;

function get(env: Env, ident: bril.Ident) {
  let val = env.get(ident);
  if (typeof val === 'undefined') {
    throw `undefined variable ${ident}`;
  }
  return val;
}

function alloc(ptrType: bril.PointerType, amt:number, heap:Heap<Value>): Pointer {
  if (typeof ptrType != 'object') {
    throw `unspecified pointer type ${ptrType}`
  } else if (amt <= 0) {
    throw `must allocate a positive amount of memory: ${amt} <= 0`
  } else {
    let loc = heap.alloc(amt)
    let dataType = ptrType.ptr;
    if (dataType !== "int" && dataType !== "bool") {
      dataType = "ptr";
    }
    return {
      loc: loc,
      type: dataType
    }
  }
}

/**
 * Ensure that the instruction has exactly `count` arguments,
 * throwing an exception otherwise.
 */
function checkArgs(instr: bril.Operation, count: number) {
  if (instr.args.length != count) {
    throw `${instr.op} takes ${count} argument(s); got ${instr.args.length}`;
  }
}

function getPtr(instr: bril.Operation, env: Env, index: number): Pointer {
  let val = get(env, instr.args[index]);
  if (typeof val !== 'object' || val instanceof BigInt) {
    throw `${instr.op} argument ${index} must be a Pointer`;
  }
  return val;
}

function getInt(instr: bril.Operation, env: Env, index: number): bigint {
  let val = get(env, instr.args[index]);
  if (typeof val !== 'bigint') {
    throw `${instr.op} argument ${index} must be a number`;
  }
  return val;
}

function getBool(instr: bril.Operation, env: Env, index: number) {
  let val = get(env, instr.args[index]);
  if (typeof val !== 'boolean') {
    throw `${instr.op} argument ${index} must be a boolean`;
  }
  return val;
}

/**
 * The thing to do after interpreting an instruction: either transfer
 * control to a label, go to the next instruction, or end thefunction.
 */
type Action =
  {"label": bril.Ident} |
  {"next": true} |
  {"end": true};
let NEXT: Action = {"next": true};
let END: Action = {"end": true};

/**
 * Interpret an instruction in a given environment, possibly updating the
 * environment. If the instruction branches to a new label, return that label;
 * otherwise, return "next" to indicate that we should proceed to the next
 * instruction or "end" to terminate the function.
 */
function evalInstr(instr: bril.Instruction, env: Env, heap:Heap<Value>): Action {
  // Check that we have the right number of arguments.
  if (instr.op !== "const") {
    let count = argCounts[instr.op];
    if (count === undefined) {
      throw "unknown opcode " + instr.op;
    } else if (count !== null) {
      checkArgs(instr, count);
    }
  }

  switch (instr.op) {
  case "const":
    // Ensure that JSON ints get represented appropriately.
    let value: Value;
    if (typeof instr.value === "number") {
      value = BigInt(instr.value);
    } else {
      value = instr.value;
    }

    env.set(instr.dest, value);
    return NEXT;

  case "id": {
    let val = get(env, instr.args[0]);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "add": {
    let val = getInt(instr, env, 0) + getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "mul": {
    let val = getInt(instr, env, 0) * getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "sub": {
    let val = getInt(instr, env, 0) - getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "div": {
    let val = getInt(instr, env, 0) / getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "le": {
    let val = getInt(instr, env, 0) <= getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "lt": {
    let val = getInt(instr, env, 0) < getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "gt": {
    let val = getInt(instr, env, 0) > getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "ge": {
    let val = getInt(instr, env, 0) >= getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "eq": {
    let val = getInt(instr, env, 0) === getInt(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "not": {
    let val = !getBool(instr, env, 0);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "and": {
    let val = getBool(instr, env, 0) && getBool(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "or": {
    let val = getBool(instr, env, 0) || getBool(instr, env, 1);
    env.set(instr.dest, val);
    return NEXT;
  }

  case "print": {
    let values = instr.args.map(i => get(env, i).toString());
    console.log(...values);
    return NEXT;
  }

  case "jmp": {
    return {"label": instr.args[0]};
  }

  case "br": {
    let cond = getBool(instr, env, 0);
    if (cond) {
      return {"label": instr.args[1]};
    } else {
      return {"label": instr.args[2]};
    }
  }
  
  case "ret": {
    return END;
  }

  case "nop": {
    return NEXT;
  }

  case "alloc": {
    let amt = getInt(instr, env, 0)
    let ptr = alloc(instr.type, Number(amt), heap)
    env.set(instr.dest, ptr);
    return NEXT;
  }

  case "free": {
    let val = getPtr(instr, env, 0)
    heap.free(val.loc);
    return NEXT;
  }

  case "store": {
    let target = getPtr(instr, env, 0)
    switch (target.type) {
      case "int": {
        heap.write(target.loc, getInt(instr, env, 1))
        break;
      }
      case "bool": {
        heap.write(target.loc, getBool(instr, env, 1))
        break;
      }
      case "ptr": {
        heap.write(target.loc, getPtr(instr, env, 1))
        break;
      }
    }
    return NEXT;
  }

  case "load": {
    let ptr = getPtr(instr, env, 0)
    let val = heap.read(ptr.loc)
    if (val == undefined || val == null) {
      throw `Pointer ${instr.args[0]} points to uninitialized data`;
    } else {
      env.set(instr.dest, val)
    }
    return NEXT;
  }

  case "ptradd": {
    let ptr = getPtr(instr, env, 0)
    let val = getInt(instr, env, 1)
    env.set(instr.dest, { loc: ptr.loc.add(Number(val)), type: ptr.type })
    return NEXT;
  }
  }
  unreachable(instr);
  throw `unhandled opcode ${(instr as any).op}`;
}

function evalFunc(func: bril.Function, heap: Heap<Value>): number {
  let env: Env = new Map();
  let num_insns_executed = 0;
  for (let i = 0; i < func.instrs.length; ++i) {
    let line = func.instrs[i];
    num_insns_executed++;
    if ('op' in line) {
      let action = evalInstr(line, env, heap);

      if ('label' in action) {
        // Search for the label and transfer control.
        for (i = 0; i < func.instrs.length; ++i) {
          let sLine = func.instrs[i];
          if ('label' in sLine && sLine.label === action.label) {
            break;
          }
        }
        if (i === func.instrs.length) {
          throw `label ${action.label} not found`;
        }
      } else if ('end' in action) {
        return num_insns_executed;
      }
    }
  }
  return num_insns_executed;
}

function evalProg(prog: bril.Program) {
  let heap = new Heap<Value>()
  for (let func of prog.functions) {
    if (func.name === "main") {
      let num_insns_exectuted = evalFunc(func, heap);
      console.log("Executed " + num_insns_exectuted + " intructions.");
    }
  }
  if (!heap.isEmpty()) {
    throw `Some memory locations have not been freed by end of execution.`
  }
}

async function main() {
  let prog = JSON.parse(await readStdin()) as bril.Program;
  evalProg(prog);
}

// Make unhandled promise rejections terminate.
process.on('unhandledRejection', e => { throw e });

main();
