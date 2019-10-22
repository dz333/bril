import * as bril from './bril';
import { HashMap, HashSet, Option } from 'prelude-ts';
import { getDominators, findNaturalLoops } from './bril-opt';
import { CFGNode } from './cfg-defs';
import { dfWorklist, liveVars, DFResult } from './bril-df';
import { insert } from 'list';

export interface Ind_var_opt {
    op: "add" | "mul" | "const";
    arg: Ind_var_opt[] | string
};
type induction_variable = {var_name:string, a:Ind_var_opt, b:Option<Ind_var_opt>}

function is_loop_invariant(var_name: string, block:CFGNode, loop: HashSet<CFGNode>, reaching_definitions:DFResult<string>):boolean {
    // a variable is loop invariant if it's reaching definitions are all outside of the loop
    // or it is inside of the loop and it is a write to a constant
    let exist_reaching_inside_block = false;
    for (let loop_block of loop) {
        let reaching_vars = reaching_definitions.ins.get(loop_block);
        reaching_vars.map((reaching_vars) => {
            for (let reaching_var of reaching_vars) {
                if (reaching_var == var_name) {
                    exist_reaching_inside_block = true;
                }
            }
        });
    }
    for (let instr of block.getInstrs()) {
        // overly optimistic
        if (bril.isValueInstruction(instr) && instr.dest == var_name) {
            exist_reaching_inside_block = true;
        }
    }
    if (exist_reaching_inside_block) {
        for (let loop_block of loop) {
            for (let inst of loop_block.getInstrs()) {
                // even if there are multiple constant writes inside of a loop,
                // at any specific point in the loop the value will be loop invariant
                if (bril.isValueInstruction(inst) && inst.dest == var_name && inst.op != "const") {
                    // return false if there is a non-constant write to [var_name]
                    return false;
                }
            }
        }
        return true;
    } else {
        return true;
    }
}

function get_basic_induction_vars(loop: HashSet<CFGNode>, reaching_definitions: DFResult<string>) {
    let maybe_basic_ind_vars: HashMap<string, induction_variable[]> = HashMap.empty();
    // find constant variables
    // find instructions of the form v = add v const or v = ptradd v const
    for (let block of loop) {
        for (let instr of block.getInstrs()) {
            if (bril.isValueInstruction(instr)) {
                if (instr.op == "add" || instr.op == "ptradd") {
                    let dest_index = instr.args.indexOf(instr.dest);
                    if (dest_index != -1) {
                        let other_args = instr.args.slice(0, dest_index).concat(instr.args.slice(dest_index+1));
                        let all_loop_inv = true;
                        for (let arg of other_args) {
                            if (!is_loop_invariant(arg, block, loop, reaching_definitions)) {
                                all_loop_inv = false;
                            }
                        }
                        if (all_loop_inv) {
                            let instrs_option = maybe_basic_ind_vars.get(instr.dest);
                            if (instrs_option.isNone()) {
                                let ind_var:induction_variable = {var_name:instr.dest, a:{op:"const", arg: other_args[0]}, b:Option.none()};
                                maybe_basic_ind_vars = maybe_basic_ind_vars.put(instr.dest, [ind_var]); 
                            } else if (instrs_option.isSome()) {
                                let instrs = instrs_option.get();
                                let ind_var:induction_variable = {var_name:instr.dest, a:{op:"const", arg: other_args[0]}, b:Option.none()};
                                instrs.push(ind_var);
                                maybe_basic_ind_vars = maybe_basic_ind_vars.put(instr.dest, instrs);
                            }
                        }
                    }

                }

            }
        }
    }

    let basic_ind_vars: HashMap<string, induction_variable> = HashMap.empty();
    for (let [var_name, instrs] of maybe_basic_ind_vars) {
        if (instrs.length == 1) {
            basic_ind_vars = basic_ind_vars.put(var_name, instrs[0]);
        }
    }
    return basic_ind_vars;
}

function extract_derived_ind_var(instr: bril.ValueInstruction, block: CFGNode, basic_ind_vars: HashMap<string, induction_variable>, loop: HashSet<CFGNode>, reaching_definitions: DFResult<string>): Option<induction_variable> {
    if (instr.op == "add" || instr.op == "mul" || instr.op == "ptradd") {
         // one arg is induction variable, one arg is loop invariant
        for (let i = 0; i < instr.args.length; i++) {
            let arg = instr.args[i];
            let basic_ind_var_option = basic_ind_vars.get(arg);
            if (basic_ind_var_option.isSome()) {
                let basic_ind_var = basic_ind_var_option.get();
                if (basic_ind_var.var_name != instr.dest) {
                    let other_arg = instr.args[1-i];
                    if (is_loop_invariant(other_arg, block, loop, reaching_definitions)) {
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

function get_derived_induction_variables(basic_ind_vars: HashMap<string, induction_variable>, loop: HashSet<CFGNode>, reaching_definitions: DFResult<string>) {
    let derived_ind_vars:HashMap<string, induction_variable> = HashMap.empty();
    for (let block of loop) {
        for (let instr of block.getInstrs()) {
            if (bril.isValueInstruction(instr)) {
                let derived_ind_var = extract_derived_ind_var(instr, block, basic_ind_vars, loop, reaching_definitions);
                if (derived_ind_var.isSome()) {
                    derived_ind_vars = derived_ind_vars.put(instr.dest, derived_ind_var.get());
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

export function eliminateInductionVars(func: CFGNode[]) {
    let dominators = getDominators(func[0]);
    let loops = findNaturalLoops(func, dominators);
    let reaching_definitions = dfWorklist(func, liveVars);

    for (let loop of loops) {
        let basic_ind_vars = get_basic_induction_vars(loop, reaching_definitions);
        let derived_ind_vars = get_derived_induction_variables(basic_ind_vars, loop, reaching_definitions);
        console.log(basic_ind_vars);
        console.log(derived_ind_vars);
    }


}