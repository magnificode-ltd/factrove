// Caps concurrent Argon2id verifications on one API process. Unlock reserves a
// slot before hashing. A saturated gate fails immediately so requests do not
// queue and hold memory. The owner hash path is not gated; it is authenticated
// and rare.

export const ARGON2_VERIFY_LIMIT = 4;

export class Argon2VerifyGate {
  private inUse = 0;

  constructor(private readonly max = ARGON2_VERIFY_LIMIT) {}

  get used(): number {
    return this.inUse;
  }

  tryAcquire(): boolean {
    if (this.inUse >= this.max) {
      return false;
    }
    this.inUse += 1;
    return true;
  }

  release(): void {
    if (this.inUse > 0) {
      this.inUse -= 1;
    }
  }
}

export const argon2VerifyGate = new Argon2VerifyGate();

