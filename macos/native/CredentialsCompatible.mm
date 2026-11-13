// Keep archived revisions immutable. This revision uses system-owned partition
// records and reuses the established request, crypto and verified-alias cleanup.
#ifndef VOXCUE_COMPATIBLE_HARDENED_SOURCE
#ifdef VOXCUE_FIXTURE_HARDENED_SOURCE
#define VOXCUE_COMPATIBLE_HARDENED_SOURCE VOXCUE_FIXTURE_HARDENED_SOURCE
#else
#define VOXCUE_COMPATIBLE_HARDENED_SOURCE "CredentialsHardened.mm"
#endif
#endif
#undef VOXCUE_CREDENTIAL_FROZEN_SOURCE
#define VOXCUE_CREDENTIAL_FROZEN_SOURCE "CredentialsPolicy.mm"
#ifdef VOXCUE_CREDENTIAL_CLEANUP_SOURCE
#include VOXCUE_CREDENTIAL_CLEANUP_SOURCE
#else
#include "CredentialsMigrating.mm"
#endif
