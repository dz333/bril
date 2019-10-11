/**
 * The definition of the Bril language.
 */

/**
 * A variable name.
 */
export type Ident = string;

/**
 * Value types.
 */
export type Type = "int" | "bool" | "ptr";

/**
 * The types to which a pointer may be pointing;
 */
export type PointerType = {
  "ptr" : Type | PointerType;
}

/**
 * An instruction that does not produce any result.
 */
export interface EffectOperation {
  op: "br" | "jmp" | "print" | "ret" |
      "store" | "free";
  args: Ident[];
}

/**
 * An operation that produces a value and places its result in the
 * destination variable.
 */
export interface ValueOperation {
  op: "add" | "mul" | "sub" | "div" |
      "id" | "nop" |
      "eq" | "lt" | "gt" | "ge" | "le" | "not" | "and" | "or" |
      "load" | "ptradd";
  args: Ident[];
  dest: Ident;
  type: Type;
}

export interface PointerValueOperation {
  op: "alloc";
  args: Ident[];
  dest: Ident;
  type: PointerType;
}

/**
 * The type of Bril values that may appear in constants.
 */
export type Value = number | boolean;


/**
 * An instruction that places a literal value into a variable.
 */
export interface Constant {
  op: "const";
  value: Value;
  dest: Ident;
  type: Type;
}

/**
 * Operations take arguments, which come from previously-assigned identifiers.
 */
export type Operation = EffectOperation | ValueOperation | PointerValueOperation;

/**
 * Instructions can be operations (which have arguments) or constants (which
 * don't). Both produce a value in a destination variable.
 */
export type Instruction = Operation | Constant;

export function isOperation(i: Instruction): i is Operation {
  return i.op != "const";
}

/**
 * Both constants and value operations produce results.
 */
export type ValueInstruction = Constant | ValueOperation;

export function isValueInstruction(object: any): object is ValueInstruction {
  return 'dest' in object;
}

/**
 * The valid opcodes for value-producing instructions.
 */
export type ValueOpCode = ValueOperation["op"];
export type PointerValueOpCode = PointerValueOperation["op"];

/**
 * The valid opcodes for effecting operations.
 */
export type EffectOpCode = EffectOperation["op"];


/**
 * All valid operation opcodes.
 */
export type OpCode = ValueOpCode | EffectOpCode | PointerValueOpCode;

/**
 * Jump labels just mark a position with a name.
 */
export interface Label {
  label: Ident;
}

/**
 * A function consists of a sequence of instructions.
 */
export interface Function {
  name: Ident;
  instrs: (Instruction | Label)[];
}

/**
 * A program consists of a set of functions, one of which must be named
 * "main".
 */
export interface Program {
  functions: Function[];
}
