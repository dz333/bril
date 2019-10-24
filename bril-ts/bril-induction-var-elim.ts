import * as bril from './bril';
import { HashMap, HashSet, Option } from 'prelude-ts';
import { getDominators, findNaturalLoops, Loop, addHeader, getUses } from './bril-opt';
import { CFGNode, TerminatingBlock } from './cfg-defs';
import { dfWorklist, DFResult, Definition, written, setUnion, getInstructionAt, reachingDefinitions, liveVars } from './bril-df';
import { Hash } from 'crypto';

export interface Ind_var_opt {
    op: "add" | "mul" | "ptradd" | "ptrconst" | "const";
    arg: Ind_var_opt[] | string
};
type induction_variable = {var_name:string, a:Ind_var_opt, b:Option<Ind_var_opt>}

function is_loop_invariant(var_name: string, loop: HashSet<CFGNode>, reaching_definitions:DFResult<Definition>):boolean {
    // a variable is loop invariant if it's reaching definitions are all outside of the loop
    // or there is exactly one inside of the loop and it is a write to a constant
    let defs:HashSet<Definition> = HashSet.empty();
    for (let loop_block of loop) {
        let reaching_defs = reaching_definitions.ins.get(loop_block).getOrThrow().filter( d => {
            return d.varName == var_name && loop.contains(d.loc.block);
        });
        defs = defs.addAll(reaching_defs);
    }
    if (!defs.isEmpty()) {
        let def = defs.single();
        if (def.isSome()) {
            let inst = getInstructionAt(def.get().loc);
            if (bril.isConstant(inst)) {
                return true;
            }
        }
        return false;
    } else {
        return true;
    }
}

function getLoopDefinitions(loop: HashSet<CFGNode>) {
    let result:HashMap<string, HashSet<Definition>> = HashMap.empty();
    for (let block of loop) {
        block.getInstrs().forEach((instr, instr_idx) => {
            if (bril.isValueInstruction(instr)) {
                let def = new Definition(instr.dest, {block: block, index: instr_idx});
                let defs = result.get(instr.dest);
                if (defs.isSome()) {
                    result = result.put(instr.dest, defs.get().add(def));
                } else {
                    result = result.put(instr.dest, HashSet.of(def));
                }
            }
        })
    }
    return result;
}

function get_basic_induction_vars(loop: HashSet<CFGNode>, reaching_definitions: DFResult<Definition>): HashMap<string, [bril.ValueInstruction,induction_variable]> {
    let basic_ind_vars: HashMap<string, [bril.ValueInstruction, induction_variable]> = HashMap.empty();
    // find constant variables
    // find instructions of the form v = add v const or v = ptradd v const

    let loopDefs = getLoopDefinitions(loop);

    for (let [_, defs] of loopDefs) {
        let def_option = defs.single();
        if (def_option.isSome()) {
            let def = def_option.get();
            let instr = def.loc.block.getInstrs()[def.loc.index];
            if (bril.isValueInstruction(instr)) {
                if (instr.op == "add" || instr.op == "ptradd") {
                    let dest_index = instr.args.indexOf(instr.dest);
                    if (dest_index != -1) {
                        let other_args = instr.args.slice(0, dest_index).concat(instr.args.slice(dest_index+1));
                        let all_loop_inv = true;
                        for (let arg of other_args) {
                            if (!is_loop_invariant(arg, loop, reaching_definitions)) {
                                all_loop_inv = false;
                            }
                        }
                        if (all_loop_inv) {
                            let ind_var:induction_variable = {var_name:instr.dest, a:{op:instr.op == "add" ? "const" : "ptrconst", arg: other_args[0]}, b:Option.none()};
                            basic_ind_vars = basic_ind_vars.put(instr.dest, [instr,ind_var]); 
                        }
                    }

                }

            }
        }
    }

    return basic_ind_vars;
}

function extract_derived_ind_var(instr: bril.ValueInstruction,
     basic_ind_vars: HashMap<string, [bril.ValueInstruction,induction_variable]>, loop: HashSet<CFGNode>, reaching_definitions: DFResult<Definition>): Option<induction_variable> {
    if (instr.op == "add" || instr.op == "mul" || instr.op == "ptradd") {
         // one arg is induction variable, one arg is loop invariant
        for (let i = 0; i < instr.args.length; i++) {
            // arg is the induction variable name
            let arg = instr.args[i];
            let basic_ind_var_option = basic_ind_vars.get(arg);
            if (basic_ind_var_option.isSome()) {
                let [_, basic_ind_var] = basic_ind_var_option.get();
                if (basic_ind_var.var_name != instr.dest) {
                    // other_arg is the loop invariant part
                    let other_arg = instr.args[1-i];
                    if (is_loop_invariant(other_arg, loop, reaching_definitions)) {
                        if (instr.op == "add" || instr.op == "ptradd") {
                            let new_b: Ind_var_opt;
                            if (basic_ind_var.b.isNone()) {
                                new_b = {op: "const", arg: other_arg};
                            } else {
                                let old_b = basic_ind_var.b.get();
                                new_b = {op: "add", arg: [{op: "const", arg: other_arg}, old_b]}
                            }
                            return Option.some({var_name: arg, a:basic_ind_var.a, b:Option.some(new_b)})
                        } else if (instr.op == "mul") {
                            let new_a: Ind_var_opt = {op: "mul", arg: [{op: "const", arg: other_arg}, basic_ind_var.a]};
                            let new_b: Option<Ind_var_opt>;
                            if (basic_ind_var.b.isNone()) {
                                new_b = Option.none();
                            } else {
                                let old_b = basic_ind_var.b.get();
                                new_b = Option.some({op: "mul", arg: [{op: "const", arg: other_arg}, old_b]});
                            }
                            return Option.some({var_name: arg, a:new_a, b:new_b})
                        }
                    }
                }
            }
        }           
    }
    return Option.none();
}

function get_derived_induction_variables(
    basic_ind_vars: HashMap<string, [bril.ValueInstruction,induction_variable]>,
     loop: HashSet<CFGNode>, reaching_definitions: DFResult<Definition>): HashMap<string, [bril.ValueInstruction,induction_variable]> {
    let derived_ind_vars:HashMap<string, [bril.ValueInstruction, induction_variable]> = HashMap.empty();

    let loopDefs = getLoopDefinitions(loop);

    for (let [_, defs] of loopDefs) {
        let def_option = defs.single();
        if (def_option.isSome()) {
            let def = def_option.get();
            let instr = def.loc.block.getInstrs()[def.loc.index];
            if (bril.isValueInstruction(instr)) {
                let derived_ind_var = extract_derived_ind_var(instr, basic_ind_vars, loop, reaching_definitions);
                if (derived_ind_var.isSome()) {
                    derived_ind_vars = derived_ind_vars.put(instr.dest, [instr, derived_ind_var.get()]);
                }
            }
        }
    }
    
    return derived_ind_vars;
}

// function get_basic_ind_var_equivalence_classes(loop: HashSet<CFGNode>, reaching_definitions: DFResult<string>) {
//     let basic_ind_vars = get_basic_induction_vars(loop, reaching_definitions);
//     let basic_ind_var_equivalence_classes: HashMap<string, induction_variable[]> = HashMap.empty();
//     for (let [_, ind_var] of basic_ind_vars) {
//         let existing_ind_vars_option = basic_ind_var_equivalence_classes.get(ind_var.a);
//         if (existing_ind_vars_option.isNone()) {
//             basic_ind_var_equivalence_classes = basic_ind_var_equivalence_classes.put(ind_var.a, [ind_var]);
//         } else {
//             let existing_ind_vars = existing_ind_vars_option.get();
//             existing_ind_vars.push(ind_var);
//             basic_ind_var_equivalence_classes = basic_ind_var_equivalence_classes.put(ind_var.a, existing_ind_vars);
//         }
//     }
//     return basic_ind_var_equivalence_classes;
// }

function replace_ind_vars(is_ptr:boolean, basic_var: string, a_var: string, b_var:Option<string>,
     derived_var:string, gen_fresh_vars:() => string, loop_header:CFGNode, loop: Loop, reaching_definitions: DFResult<Definition>) {
    // i = i + c; i -> i,c,0
    
    // i < n
    // t = c*n + d
    // k < c*n + d
    let header_instrs = loop_header.getInstrs();
    for (let block of loop.blocks) {

        let result_instrs: bril.Instruction[] = [];
        for (let instr of block.getInstrs()) {
            if (instr.op == "lt" && instr.args.indexOf(basic_var) != -1) {
                let n = instr.args[1-instr.args.indexOf(basic_var)];
                if (is_loop_invariant(n, loop.blocks, reaching_definitions)) {
                    let mul_var = gen_fresh_vars();
                    let mul_instr: bril.ValueInstruction = {op:"mul", args:[n, a_var], type:"int", dest:mul_var};
                    header_instrs.push(mul_instr);
                    let ret_var = mul_var;
                    if (b_var.isSome()) {
                        let add_var = gen_fresh_vars();
                        let add_instr: bril.ValueInstruction = {op:is_ptr ? "ptradd" : "add", args:[b_var.get(), mul_var], type:is_ptr ? {"ptr":"int"} : "int", dest:add_var};    
                        header_instrs.push(add_instr);
                        ret_var = add_var;
                    }
                    let new_comp: bril.ValueInstruction = {op:is_ptr ? "ptrlt" : "lt", args:[derived_var, ret_var], type:"bool", dest:instr.dest};
                    result_instrs.push(new_comp);
                } else {
                    result_instrs.push(instr);
                }
            } else {
                result_instrs.push(instr);
            }
        }
        block.setInstrs(result_instrs);
    }

}

function fresh_vars(existing: HashSet<string>) {
    let fresh_var = 0;
    return () => {
        let new_var = "__"+(fresh_var++);
        while(existing.contains(new_var)) {
            new_var = "__"+(fresh_var++);
        }
        return new_var;
    }
}


function canElimVariableDefintion(varName: string, prog: CFGNode[], loop: Loop, loopDefs: HashSet<Definition>) {
    //check that varName is not a live out of the loop
    let liveOuts: HashSet<string> = getLoopLiveOuts(prog, loop);
    if (liveOuts.contains(varName)) {
        return false;
    }
    //check that varName is defined exactly once inside the loop
    let def = loopDefs.filter( d => { return d.varName == varName; }).single();
    if (def.isNone()) {
        return false;
    }
    //check that all uses of varName are in exactly def
    let uses = getUses(varName, loop.blocks.toArray()).single();
    return uses.isSome() && uses.get().equals(def.get());
}

function getLoopLiveOuts(prog: CFGNode[], loop: Loop) {
    let lives = dfWorklist(prog, liveVars);
    let loopSucc: HashSet<CFGNode> = loop.blocks.foldLeft(HashSet.empty(), (soFar, block) => {
        return soFar.addAll(block.getSuccessors().filter(n => {
            return !loop.blocks.contains(n);
        }));
    });
    let loopOuts: HashSet<string> = HashSet.empty();
    loopSucc.forEach(b => {
        loopOuts = loopOuts.addAll(lives.ins.get(b).getOrThrow());
    });
    return loopOuts;
}

function gen_instrs_from_ind_var_opt(opt: Ind_var_opt, gen_fresh_vars: () => string): [string, bril.ValueInstruction[]] {
    if (typeof opt.arg  === "string") {
        return [opt.arg, []];
    } else {
        if (opt.op == "add" || opt.op == "mul" || opt.op == "ptradd") {
            let [left_dest, left_instrs] = gen_instrs_from_ind_var_opt(opt.arg[0], gen_fresh_vars)
            let [right_dest, right_instrs] = gen_instrs_from_ind_var_opt(opt.arg[1], gen_fresh_vars)
            let tmp_var = gen_fresh_vars();
            return [tmp_var, left_instrs.concat(right_instrs).concat([{op:opt.op, dest:tmp_var, type:"int", args:[left_dest, right_dest]}]) ]
        } else {
            throw "Invalid ind var opt"
        }
    }
}

function strength_reduction(is_ptr:boolean, dest: string, gen_fresh_vars: () => string, ind_var: induction_variable, loop: Loop, loop_header:CFGNode): [string, Option<string>, string] {
    // k = i + d; k -> i,c,d
    // t = i*c + d
    // k = t
    // t = t + c
    let instrs = loop_header.getInstrs();
    let [a_var, a_instrs] = gen_instrs_from_ind_var_opt(ind_var.a, gen_fresh_vars);
    let tmp_var = gen_fresh_vars();
    let ret_b_var: Option<string> = Option.none();
    if (ind_var.b.isNone()) {
        instrs = instrs.concat(a_instrs).concat([{op:"mul", dest:tmp_var, type:"int", args:[ind_var.var_name, a_var]}]);
    } else {
        let [b_var, b_instrs] = gen_instrs_from_ind_var_opt(ind_var.b.get(), gen_fresh_vars);
        ret_b_var = Option.some(b_var);
        instrs = instrs.concat(a_instrs).concat(b_instrs);
        let tmp_var_2 = gen_fresh_vars();
        let mul_instr: bril.ValueInstruction = {op:"mul", dest:tmp_var_2, type:"int", args:[ind_var.var_name, a_var]};
        let add_instr: bril.ValueInstruction = {op:is_ptr ? "ptradd" : "add", dest:tmp_var, type:is_ptr ? {"ptr":"int"} : "int", args:[b_var, tmp_var_2]}
        instrs = instrs.concat(a_instrs).concat([mul_instr, add_instr]);
    }
    loop_header.setInstrs(instrs);

    for (let block of loop.blocks) {
        let result_instrs: bril.Instruction[] = [];
        for (let instr of block.getInstrs()) {
            if (bril.isValueInstruction(instr)) {
                if (instr.dest == dest) {
                    result_instrs.push({op:"id", args:[tmp_var], dest:dest, type:is_ptr ? {"ptr":"int"} : "int"});
                } else if (instr.dest == ind_var.var_name) {
                    result_instrs.push(instr);
                    result_instrs.push({op:is_ptr ? "ptradd" : "add", dest:tmp_var, type:is_ptr ? {"ptr":"int"} : "int", args:[tmp_var, a_var]});
                } else {
                    result_instrs.push(instr);
                }
            } else {
                result_instrs.push(instr);
            }
        }
        block.setInstrs(result_instrs);
    }
    return [a_var, ret_b_var, tmp_var];
}

export function eliminateInductionVars(func: CFGNode[]) {
    let dominators = getDominators(func[0]);
    let loops = findNaturalLoops(func, dominators);
    let reaching_definitions = dfWorklist(func, reachingDefinitions);
    let defined: HashSet<string> = HashSet.empty();
    for (let block of func) {
        defined = setUnion([defined, written(block)]);
    }

    let gen_fresh_vars = fresh_vars(defined);

    for (let loop of loops) {
        let basic_ind_vars = get_basic_induction_vars(loop.blocks, reaching_definitions);
        let derived_ind_vars = get_derived_induction_variables(basic_ind_vars, loop.blocks, reaching_definitions);
        let block:TerminatingBlock = {
            name: loop.entry.name + "_preentry",
            idx: 0,
            instrs: [],
            termInstr: {op:"jmp", args:[loop.entry.name]}
        };
        // console.log(basic_ind_vars);
        // console.log(derived_ind_vars);
        let preentry = new CFGNode(block.name, block, HashSet.empty(), HashSet.empty());
        addHeader(func, loop.entry, preentry, loop.blocks.remove(loop.entry));
        func.push(preentry);
        let replaced_basic_vars: HashSet<string> = HashSet.empty();
        for (let [dest, [instr, ind_var]] of derived_ind_vars) {
            let is_ptr = instr.op == "ptradd";
            let [a_var, b_var, new_dest] = strength_reduction(is_ptr, dest, gen_fresh_vars, ind_var, loop, preentry);
            // no fancy heuristic, just replace the basic induction variable with the first derived induction variable that we find
            if (!replaced_basic_vars.contains(ind_var.var_name)) {
                replace_ind_vars(is_ptr, ind_var.var_name, a_var, b_var, new_dest, gen_fresh_vars, preentry, loop, reaching_definitions);
                replaced_basic_vars = replaced_basic_vars.add(ind_var.var_name);
            }
        }
        let loop_defs:HashSet<Definition> = HashSet.empty();
        for (let block of loop.blocks) {
            block.getInstrs().forEach((i, idx) => {
                if (bril.isValueInstruction(i)) {
                    let def = new Definition(i.dest, { block: block, index: idx } );
                    loop_defs = loop_defs.add(def);
                }
            });
        }

        for (let ind_var of replaced_basic_vars) {
            let can_elim_var = canElimVariableDefintion(ind_var, func, loop, loop_defs);
            // console.log(can_elim_var+","+ind_var);
            if (can_elim_var) {
                for (let block of loop.blocks) {
                    let result_instrs = [];
                    for (let instr of block.getInstrs()) {
                        if (bril.isValueInstruction(instr) && instr.dest == ind_var) {
                            // nothing
                        } else {
                            result_instrs.push(instr);
                        }
                        block.setInstrs(result_instrs);
                    }
                }

            }
        }
    }
}