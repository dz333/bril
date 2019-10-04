#!/usr/bin/env node
import * as bril from './bril';
import * as cfg from './bril-opt';
import { readStdin } from './util';
import { Option, HashSet } from 'prelude-ts';

async function main() {
    let prog = JSON.parse(await readStdin()) as bril.Program;
    let graph = cfg.createFunctionCFG("main", prog);
    let doms = cfg.getDominators(graph[0]);
    cfg.printCFG("main", graph, Option.some(doms));
    let loops = cfg.findNaturalLoops(graph, doms);
    for (let l of loops) {
        process.stderr.write("Loop: " + l.toString() + "\n");
    }
}
process.on('unhandledRejection', e => { throw e });
  
main()