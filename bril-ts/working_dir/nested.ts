let value = 10;
let val2 = 8;
let result = 1;
for (let i = value; i > 0; i = i - 1) {
  for (let j = val2; j > 0; j = j - 1) {
      result = result + 1;
  }
}
console.log(result);