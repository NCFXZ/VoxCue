param([Parameter(Mandatory=$true)][string]$ToolchainRoot,[Parameter(Mandatory=$true)][string]$BuildRoot,[Parameter(Mandatory=$true)][string]$VadLibrary,[switch]$Cpu,[switch]$Examples,[switch]$Tests)
$ErrorActionPreference='Stop'
# Build-time tooling only. The managed component contains the resulting EXE,
# CPU-only speech.dll and CUDA redistributables; end users need no toolchain.
$spec=Get-Content -LiteralPath (Join-Path $ToolchainRoot 'msvc/env.json') -Raw|ConvertFrom-Json
foreach($p in $spec.PSObject.Properties){if($p.Name -notin @('TOOL_VERSIONS','PATH')){$value=if($p.Value -is [array]){$p.Value -join ';'}else{[string]$p.Value};[Environment]::SetEnvironmentVariable($p.Name,$value,'Process')}}
$env:PATH=$VadLibrary+';'+(Join-Path $ToolchainRoot 'cuda/bin')+';'+($spec.PATH -join ';')+';'+$env:PATH
$env:CUDA_PATH=Join-Path $ToolchainRoot 'cuda';$env:CUDA_HOME=$env:CUDA_PATH
# PTX for Ampere also JITs on newer architectures (including RTX 4060).
$env:CUDA_COMPUTE_CAP='80';$env:CUDARC_CUDA_VERSION='12090'
$env:RUSTUP_HOME=Join-Path $ToolchainRoot 'rustup';$env:CARGO_HOME=Join-Path $ToolchainRoot 'cargo'
$env:CARGO_TARGET_DIR=Join-Path $BuildRoot 'cargo-target';$env:RUSTUP_TOOLCHAIN='stable-x86_64-pc-windows-msvc'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=Join-Path (Split-Path -Parent $spec.CC) 'link.exe'
$env:RUSTFLAGS='-C target-cpu=x86-64-v2';$env:CARGO_BUILD_JOBS='6';$env:RAYON_NUM_THREADS='4'
$env:LIB=(Join-Path $ToolchainRoot 'cuda/lib/x64')+';'+$env:LIB
$env:TMP=$BuildRoot;$env:TEMP=$BuildRoot;$env:VOXCUE_VAD_LIB=$VadLibrary
$manifest=Join-Path $PSScriptRoot '../../shared/native/qwen-speech/Cargo.toml'
$arguments=@('build','--release','--locked','--offline','--manifest-path',$manifest)
if($Tests){
  if($Examples){throw 'Choose either -Tests or -Examples'}
  $arguments=@('test','--release','--locked','--offline','--manifest-path',$manifest,'-p','voxcue-qwen','--bin','voxcue-qwen')
}
if($Cpu){$env:CARGO_TARGET_DIR=Join-Path $BuildRoot 'cargo-target-cpu';$arguments+='--no-default-features'}
if($Examples){$arguments+='--examples'}
& (Join-Path $ToolchainRoot 'cargo/bin/cargo.exe') @arguments
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
if($Tests){
  # Test the production library; the upstream CLI is not packaged with VoxCue.
  $libraryArguments=@('test','--release','--locked','--offline','--manifest-path',$manifest,'-p','voxcue-qwen','-p','qwen-forced-aligner-rs','--lib')
  if($Cpu){$libraryArguments+='--no-default-features'}
  & (Join-Path $ToolchainRoot 'cargo/bin/cargo.exe') @libraryArguments
}
exit $LASTEXITCODE
