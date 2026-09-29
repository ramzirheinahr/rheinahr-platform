"""Animated vertical RheinAhr visual sample. All names and figures are fictitious."""
import math, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W,H,FPS,DUR=720,1280,24,23
BLUE=(27,63,137); DARK=(8,23,52); WHITE=(255,255,255); MUTED=(106,125,156)
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
BOLD='/System/Library/Fonts/Supplemental/Arial Bold.ttf'
F={}
def font(n,b=False):
    key=(n,b)
    if key not in F: F[key]=ImageFont.truetype(BOLD if b else FONT,n)
    return F[key]
def ease(x):
    x=max(0,min(1,x)); return x*x*(3-2*x)
def lerp(a,b,t): return a+(b-a)*t
def text(d,xy,s,size=30,color=WHITE,bold=False,anchor=None): d.text(xy,s,font=font(size,bold),fill=color,anchor=anchor)
def box(d,xy,r=20,fill=WHITE,outline=None,width=2): d.rounded_rectangle(tuple(map(int,xy)),radius=r,fill=fill,outline=outline,width=width)
def circle(d,xy,r,fill=None,outline=None,width=1): d.ellipse((int(xy[0]-r),int(xy[1]-r),int(xy[0]+r),int(xy[1]+r)),fill=fill,outline=outline,width=width)

bg=Image.new('RGB',(W,H)); bd=ImageDraw.Draw(bg)
for y in range(H):
    v=y/H; bd.line((0,y,W,y),fill=(int(8+13*v),int(24+31*v),int(55+80*v)))

def base(t,kicker,headline,sub):
    im=bg.copy().convert('RGBA'); d=ImageDraw.Draw(im,'RGBA')
    for i in range(12):
        x=(i*101-140+t*11)%900-80; y=(i*137+100)%1280
        circle(d,(x,y),2,(145,190,255,255))
    for gx in range(0,W,72): d.line((gx,0,gx,H),fill=(43,67,112,255),width=1)
    for gy in range(0,H,72): d.line((0,gy,W,gy),fill=(43,67,112,255),width=1)
    box(d,(42,45,250,86),18,(39,68,116,255)); text(d,(61,57),kicker,17,(214,230,255),True)
    text(d,(42,139),headline,49,WHITE,True)
    text(d,(43,203),sub,24,(194,215,246))
    text(d,(44,1221),'RHEINAHR  ·  PERSONALDIENSTLEISTUNGEN',16,(167,194,234),True)
    d.rectangle((44,1253,676,1257),fill=(112,140,180,255))
    d.rectangle((44,1253,44+int(632*min(t/DUR,1)),1257),fill=(239,47,75,255))
    return im

def floating_card(im,x,y,w,h,title,body,accent=(47,91,176),alpha=255):
    layer=Image.new('RGBA',(int(w+26),int(h+30))); d=ImageDraw.Draw(layer)
    box(d,(10,13,w+10,h+13),23,(0,0,0,75))
    box(d,(0,0,w,h),23,(252,254,255,alpha))
    box(d,(18,18,67,67),13,accent)
    text(d,(42,42),'R',28,WHITE,True,'mm')
    text(d,(87,24),title,27,DARK,True)
    text(d,(87,64),body,19,MUTED)
    im.alpha_composite(layer,(int(x),int(y)))

def scene0(t):
    im=base(t,'RHEINAHR DIGITAL','Pflegepersonal','Einfach und übersichtlich anfragen')
    d=ImageDraw.Draw(im,'RGBA')
    # Glowing data stream converges on the request hub.
    center=(360,868)
    for j,(x,y,label,body) in enumerate([(53,331,'Pflegefachkraft','Qualifikation'),(53,490,'Pflegehilfskraft','Personalbedarf'),(53,649,'Pflegeassistenz','Passende Besetzung')]):
        p=ease((t-.3-j*.42)/.65)
        sx=lerp(-660,x,p); sy=y+int((1-p)*45)
        d.line((sx+565,sy+54,*center),fill=(54,183,222,255),width=3)
        floating_card(im,sx,sy,610,116,label,body,(47,91,176) if j!=1 else (225,47,75))
        if p>.9:
            u=(t*.5+j*.27)%1
            px=lerp(sx+565,center[0],u); py=lerp(sy+54,center[1],u)
            circle(d,(px,py),7,(101,237,253,220))
    q=ease((t-1.8)/.65)
    circle(d,center,90*q,(33,80,172,255),(122,230,251,255),4)
    if q>.8:
        text(d,center,'R',79,WHITE,True,'mm')
        text(d,(360,938),'Eine Anfrage. Alle Dienste.',31,WHITE,True,'mm')
        text(d,(360,982),'Digital von der Planung bis zum Einsatz',21,(189,218,250),False,'mm')
    return im

def form_card():
    im=Image.new('RGBA',(640,850)); d=ImageDraw.Draw(im)
    box(d,(10,17,630,839),29,(0,0,0,68)); box(d,(0,0,620,820),29,(249,251,255,255))
    box(d,(0,0,620,81),29,WHITE); d.rectangle((0,46,620,82),fill=WHITE)
    circle(d,(42,40),10,(232,39,63)); text(d,(68,25),'RheinAhr',30,(40,78,158),True)
    text(d,(30,133),'Neue Personalanfrage',34,DARK,True)
    text(d,(30,195),'Benötigte Qualifikation',24,MUTED)
    for x,y,s in [(30,230,'Pflegefachkraft'),(320,230,'Pflegehilfskraft'),(30,325,'Pflegeassistenz'),(320,325,'Pflegedienstleitung')]:
        box(d,(x,y,x+270,y+73),16,(239,244,252) if x==30 and y==230 else WHITE,(54,102,196) if x==30 and y==230 else (214,224,239),3 if x==30 and y==230 else 2)
        text(d,(x+135,y+38),s,19,(39,72,139) if x==30 and y==230 else (98,115,139),True,'mm')
    text(d,(30,464),'Anzahl Mitarbeitende',24,MUTED)
    box(d,(30,501,590,568),14,WHITE,(214,224,239)); text(d,(54,519),'2',29,DARK,True)
    box(d,(30,683,590,756),15,(44,84,171)); text(d,(310,722),'Weiter zu den Diensten   →',25,WHITE,True,'mm')
    return im
FORM=form_card()

def scene1(t):
    im=base(t,'SCHRITT 01','Qualifikation wählen','Passend zu Ihrem Pflegebedarf')
    loc=t-5.1; p=ease(loc/.8)
    card=FORM
    angle=lerp(-13,0,p); scale=lerp(.68,1,p)
    pic=card.resize((int(640*scale),int(850*scale)),Image.Resampling.BICUBIC).rotate(angle,Image.Resampling.BICUBIC,expand=True)
    x=int(360-pic.width/2); y=int(335+(1-p)*740)
    im.alpha_composite(pic,(x,y))
    d=ImageDraw.Draw(im,'RGBA')
    if p>.9:
        q=ease((loc-1.1)/.6)
        # Animated selection pulse and pointer travel.
        cx=lerp(550,177,q); cy=lerp(1043,602,q)
        circle(d,(cx,cy),26,(245,54,77,255),(255,255,255,255),3)
        circle(d,(cx,cy),7,(240,40,68,255))
        if loc>2:
            r=30+22*((loc-2)%1)
            circle(d,(177,602),r,None,(71,204,243,255),3)
    return im

def scene2(t):
    im=base(t,'SCHRITT 02','Dienste planen','Tag, Uhrzeit und Einsatzbereich')
    d=ImageDraw.Draw(im,'RGBA'); loc=t-11.2
    # Calendar arrives as individual tiles; current day becomes the camera focus.
    box(d,(43,304,677,1076),28,(249,251,255,248))
    text(d,(75,344),'September 2026',35,DARK,True)
    cols=['Mo','Di','Mi','Do','Fr']; x0=75
    for j,s in enumerate(cols): text(d,(x0+j*117,407),s,19,MUTED,True)
    for row in range(4):
        for col in range(5):
            idx=row*5+col+7; x=x0+col*117; y=437+row*116
            box(d,(x,y,x+101,y+102),13,(244,247,252), (217,226,239),1)
            text(d,(x+13,y+11),str(idx),19,MUTED,True)
    for j,(col,row,color,label) in enumerate([(1,0,(47,91,176),'Früh'),(2,0,(40,133,130),'Spät'),(3,1,(225,67,86),'Nacht')]):
        p=ease((loc-j*.55)/.55); x=x0+col*117; y=437+row*116
        sy=lerp(-150,y+47,p)
        if p>0:
            box(d,(x+5,sy,x+96,sy+43),10,(*color,int(255*p)))
            text(d,(x+50,sy+21),label,17,WHITE,True,'mm')
            if p>.9: circle(d,(x+50,y+51),52+9*math.sin(loc*3+j),None,(65,206,237,255),2)
    if loc>1:
        p=ease((loc-1)/.65); yy=int(903+(1-p)*360)
        box(d,(75,yy,645,yy+139),20,(234,246,244,255))
        text(d,(100,yy+30),'Frühdienst  ·  Pflegefachkraft',24,(33,94,88),True)
        text(d,(100,yy+79),'08.09.  ·  06:30–14:00  ·  Bereich 2',21,(46,76,90))
        text(d,(100,yy+112),'Nettozeit: 7 Stunden',20,(33,94,88),True)
    return im

def scene3(t):
    im=base(t,'SCHRITT 03','Status verfolgen','Anfrage und Einsatz im Blick')
    d=ImageDraw.Draw(im,'RGBA'); loc=t-17.1
    p=ease(loc/.65)
    box(d,(47,330+(1-p)*700,673,550+(1-p)*700),27,(249,251,255,int(250*p)))
    if p>.1:
        text(d,(77,369),'Anfrage #2026-091',29,DARK,True)
        text(d,(77,419),'Pflegefachkraft · 08.09. · Frühdienst',21,MUTED)
        box(d,(77,472,320,521),18,(255,240,213)); text(d,(97,484),'In Bearbeitung',20,(145,95,19),True)
    x=105; y0=638; steps=['Anfrage eingegangen','Prüfung und Koordination','Mitarbeitende zugeordnet','Dienst bestätigt']
    for j,lab in enumerate(steps):
        yy=y0+j*111
        if j<3: d.line((x,yy,x,yy+111),fill=(91,152,220,int(180*ease((loc-j*.55)/.4))),width=5)
        q=ease((loc-j*.6-.4)/.5)
        circle(d,(x,yy),19*q,(42,95,185,int(255*q)) if j<2 else (191,208,230,int(255*q)))
        if q>.4: text(d,(150,yy-17),lab,23,WHITE if j<2 else (196,214,239),j<2)
    if loc>3.1:
        a=ease((loc-3.1)/.8)
        box(d,(53,1080+(1-a)*150,667,1165+(1-a)*150),19,(235,244,255,int(250*a)))
        text(d,(360,1122+(1-a)*150),'RheinAhr · Personal digital koordinieren',21,(35,73,150),True,'mm')
    return im

def make_frame(t):
    if t<5.4: im=scene0(t)
    elif t<11.4: im=scene1(t)
    elif t<17.4: im=scene2(t)
    else: im=scene3(t)
    # A short luminance crossfade at each change avoids abrupt cuts.
    for b,prev in [(5.4,scene0),(11.4,scene1),(17.4,scene2)]:
        if b<=t<b+.35:
            im=Image.blend(prev(b-.04).convert('RGBA'),im,ease((t-b)/.35))
    # A restrained push-in gives the interface depth without hiding its controls.
    phase=(t%6)/6
    # Deliberate camera push and lateral drift, timed per scene.
    zoom=1+.085*ease(phase)
    nw,nh=int(W*zoom),int(H*zoom)
    im=im.resize((nw,nh),Image.Resampling.BICUBIC)
    ox=int((nw-W)*(.18+.58*ease(phase)))
    oy=int((nh-H)*(.18+.52*ease(phase)))
    im=im.crop((ox,oy,ox+W,oy+H))
    return im.convert('RGB')

if __name__=='__main__':
    out=sys.argv[1] if len(sys.argv)>1 else 'video_sample/rheinahr_animated.mp4'
    audio=sys.argv[2] if len(sys.argv)>2 else 'video_sample/narration.aiff'
    cmd=['ffmpeg','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','-','-i',audio,'-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-t',str(DUR),'-movflags','+faststart',out,'-loglevel','error']
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    try:
        for n in range(FPS*DUR):
            proc.stdin.write(make_frame(n/FPS).tobytes())
            if n%120==0: print(f'frames {n}/{FPS*DUR}',flush=True)
    finally:
        proc.stdin.close()
    if proc.wait()!=0: raise SystemExit('ffmpeg failed')
