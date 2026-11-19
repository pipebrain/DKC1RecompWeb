#include <setjmp.h>
#include <stdlib.h>

static jmp_buf guard;

static void unwind(void) { longjmp(guard, 42); }

/* A real allocation plus non-local unwind using the game's Wasm EH flags. */
__attribute__((export_name("runtime_probe")))
int runtime_probe(void) {
  unsigned char *memory = malloc(4096);
  if (!memory) return 1;
  for (unsigned i = 0; i < 4096; i++) memory[i] = (unsigned char)i;
  int result = setjmp(guard);
  if (!result) unwind();
  int failed = result != 42;
  for (unsigned i = 0; i < 4096; i++)
    if (memory[i] != (unsigned char)i) failed = 1;
  free(memory);
  return failed;
}
