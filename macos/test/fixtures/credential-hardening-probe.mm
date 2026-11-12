// No production code changes: the fixture's explicit Keychain argument is also
// constrained inside the helper, independently of the parent launcher.
#include "credential-fixture-boundary.h"
#define VOXCUE_CREDENTIAL_FIXTURE 1
#define SecKeychainOpen openFixtureKeychain
#ifndef VOXCUE_FIXTURE_HARDENED_SOURCE
#error An isolated parent identity source copy is required
#endif
#include VOXCUE_FIXTURE_HARDENED_SOURCE
#undef SecKeychainOpen
