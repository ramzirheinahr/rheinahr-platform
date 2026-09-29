"""Short original interface sounds for the animated sample."""
import math, random, struct, wave

SR=44100; DUR=23; random.seed(8)
samples=[0.0]*(SR*DUR)
def add(start,length,fn):
    a=int(start*SR); n=int(length*SR)
    for i in range(n):
        if a+i<len(samples): samples[a+i]+=fn(i/SR,i/n)
def click(t):
    add(t,.16,lambda x,p: .16*math.exp(-35*x)*math.sin(2*math.pi*(980-260*p)*x))
    add(t,.035,lambda x,p: .08*(1-p)*(random.random()*2-1))
def whoosh(t):
    # Soft rising sweep with a brief airy finish.
    add(t,.47,lambda x,p: .095*math.sin(math.pi*p)**2*math.sin(2*math.pi*(170*x+440*x*x)))
    add(t,.47,lambda x,p: .035*math.sin(math.pi*p)**2*(random.random()*2-1))
def chime(t):
    add(t,.46,lambda x,p: .07*math.exp(-6*x)*(math.sin(2*math.pi*660*x)+.5*math.sin(2*math.pi*990*x)))
for t in [5.32,11.30,17.30]: whoosh(t)
for t in [7.8,12.1,12.65,13.2,18.1,18.8,19.4]: click(t)
for t in [3.1,15.0,21.4]: chime(t)
with wave.open('video_sample/sfx.wav','wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h',int(max(-1,min(1,s))*32767)) for s in samples))
