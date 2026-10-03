export function processCustomer(name: string, age: number) {
  const greeting = "Hello, " + name;
  const isAdult = age >= 18;
  const status = isAdult ? "adult" : "minor";
  console.log(greeting + " you are " + status);
  return { greeting, isAdult, status };
}
