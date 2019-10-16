import * as fs from 'fs';
/**
 * Read all the data from stdin as a string.
 */
export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let chunks: string[] = [];
    process.stdin.on("data", function (chunk: string) {
      chunks.push(chunk);
    }).on("end", function () {
      resolve(chunks.join(""))
    }).setEncoding("utf8");
  });
}

export async function readFile(fname: string, useStdIn: boolean): Promise<string> {
    if (useStdIn) {
      return readStdin();
    } else {
      return fs.readFileSync(fname).toString();
    }
}

export async function writeFile(output: string, fname: string, useStdOut: boolean) {
  if (useStdOut) {
    process.stdout.write(output + "\n");
  } else {
    fs.writeFileSync(fname, output + "\n");
  }
}

export function unreachable(x: never) {
  throw "impossible case reached";
}
