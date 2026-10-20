"""Fixed public FLEURS inputs/references, never benchmark results. CC-BY-4.0."""
import hashlib, io, json, os, pathlib, sys, urllib.request
state_file=pathlib.Path(sys.argv[1]);state=json.loads(state_file.read_text());root=pathlib.Path(state['root'])
owner=json.loads((root/'.voxcue-test-owner.json').read_text());os.kill(owner['pid'],0)
assert root.name.startswith('voxcue-test-run-') and owner['kind']=='voxcue-test-run-'
revision='168de341b3db6859a9bac1c50a2ef5e3b47647e0'
sets=[('en_us','6428a4d04d3aac29e16b45e039bb1470a8bd7aa334cf92f7984c9c520d1f234d'),
      ('cmn_hans_cn','87c0aebbe183f3a36ac87b5c3421b6ab57036824744ff695029a3f858e7622fd')]
files=[]
for language,digest in sets:
    file=root/'corpus'/f'{language}.parquet'
    if not file.exists():
        with urllib.request.urlopen(f'https://huggingface.co/datasets/google/fleurs/resolve/{revision}/{language}/test/0000.parquet?download=true',timeout=90) as source,open(file,'wb') as target:
            while data:=source.read(1024*1024):target.write(data)
    with open(file,'rb') as handle:assert hashlib.file_digest(handle,'sha256').hexdigest()==digest
    files.append((language,file));print('CORPUS_VERIFIED:'+language,flush=True)
import pyarrow.parquet as pq
import numpy as np
import soundfile as sf
manifest=[]
for language,file in files:
    table=pq.read_table(file)
    print('CORPUS_SCHEMA:'+language+':'+','.join(table.column_names),flush=True)
    counts={0:0,1:0}
    for index,row in enumerate(table.to_pylist()):
        gender=row['gender']
        if gender not in counts or counts[gender]>=10:continue
        samples,rate=sf.read(io.BytesIO(row['audio']['bytes']),dtype='float32')
        assert rate==16000 and samples.ndim==1
        duration=len(samples)/rate
        if not 2<=duration<=25:continue
        assert np.isfinite(samples).all() and np.max(np.abs(samples))>0
        samples=np.rint(np.clip(samples,-1,32767/32768)*32768).astype('<i2')
        name=f'{language}-{index:04d}.wav';sf.write(root/'corpus'/name,samples,rate,subtype='PCM_16')
        manifest.append({'id':name[:-4],'language':language,'reference':row.get('raw_transcription') or row['transcription'],
                         'audio':str(root/'corpus'/name),'duration':duration,'gender':gender,'row':index})
        counts[gender]+=1
        if sum(counts.values())==20:break
    assert sum(counts.values())==20,counts
    del table
(root/'corpus'/'manifest.json').write_text(json.dumps({'dataset':'google/fleurs','revision':revision,'license':'CC-BY-4.0',
  'selection':'first 10 male and 10 female eligible rows per language; 2-25s; original 16kHz PCM',
  'archives':dict(sets),'items':manifest},ensure_ascii=False))
print('CORPUS_READY:'+str(len(manifest))+':'+str(round(sum(item['duration'] for item in manifest),2)),flush=True)
