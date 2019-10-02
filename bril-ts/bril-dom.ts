#!/usr/bin/env node
import * as bril from './bril';
import * as cfg from './bril-opt';
import { readStdin } from './util';
import { Option, HashSet } from 'prelude-ts';

function printDoms(doms:cfg.DominatorMap) {
    let printSet = (x:HashSet<cfg.CFGNode>) => {
        let result = "";
        x.forEach(n => {
            result += n + ", "
        })
        return result;
    };
    doms.forEach( x => {
        process.stdout.write(x[0] + " => " + printSet(x[1]) + "\n");
    });
}

async function main() {
    let prog = JSON.parse(await readStdin()) as bril.Program;
    let graph = cfg.createFunctionCFG("main", prog);
    let doms = cfg.getDominators(graph[0]);
    cfg.printCFG("main", graph, Option.some(doms));
}
process.on('unhandledRejection', e => { throw e });
  
main()