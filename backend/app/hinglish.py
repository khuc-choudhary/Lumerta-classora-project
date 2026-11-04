"""Speech-side Hinglish: English text-to-speech voices spell short Hindi words letter by letter ("ab" -> "A B").
For speaking, common Roman-Hindi words are written in Devanagari so a Hindi voice pronounces them correctly.
The on-screen caption stays in readable Roman Hinglish. English words/terms are left untouched.
Only words that are NOT also common English words are mapped (so 'me', 'to', 'do', 'so', 'is', 'main', 'hi' stay)."""
import re

_W = """ab=अब chalo=चलो chal=चल chaliye=चलिए dekhte=देखते dekho=देखो dekhenge=देखेंगे dekhiye=देखिए dekh=देख hain=हैं hai=है hoga=होगा hogi=होगी honge=होंगे
hota=होता hoti=होती hote=होते ka=का ki=की ke=के ko=को se=से mein=में par=पर pe=पे aur=और ye=ये yeh=यह wo=वो woh=वह toh=तो nahi=नहीं nahin=नहीं kya=क्या kaise=कैसे
kyun=क्यों kyunki=क्योंकि samjho=समझो samjhte=समझते samajhte=समझते samjhenge=समझेंगे samjhaungi=समझाऊँगी samjhaunga=समझाऊँगा samjhao=समझाओ samjhana=समझाना samajh=समझ samjh=समझ
aaya=आया aayi=आई aa=आ karo=करो karte=करते karna=करना kar=कर karenge=करेंगे kijiye=कीजिए kar=कर matlab=मतलब jaise=जैसे jab=जब tab=तब phir=फिर pehle=पहले baad=बाद
aap=आप tum=तुम hum=हम mujhe=मुझे tumhe=तुम्हें humein=हमें apna=अपना apni=अपनी apne=अपने ek=एक teen=तीन  paanch=पाँच bhi=भी sab=सब yahan=यहाँ wahan=वहाँ
kuch=कुछ koi=कोई bahut=बहुत thoda=थोड़ा thodi=थोड़ी dhyan=ध्यान dena=देना lena=लेना rahi=रही raha=रहा rahe=रहे liye=लिए waise=वैसे isliye=इसलिए lekin=लेकिन agar=अगर
magar=मगर sirf=सिर्फ bilkul=बिल्कुल abhi=अभी suno=सुनो batao=बताओ bolo=बोलो likho=लिखो padho=पढ़ो sawal=सवाल jawab=जवाब iska=इसका iski=इसकी isko=इसको isme=इसमें usme=उसमें
uska=उसका unka=उनका jo=जो jisme=जिसमें jaisa=जैसा aisa=ऐसा waisa=वैसा kaun=कौन kab=कब kahan=कहाँ kitna=कितना kitne=कितने naya=नया naye=नए aasan=आसान mushkil=मुश्किल
zaroori=ज़रूरी yaad=याद samjha=समझा samjhi=समझी shuru=शुरू khatam=खत्म saath=साथ zyada=ज़्यादा kam=कम sahi=सही galat=गलत theek=ठीक achha=अच्छा accha=अच्छा
dekhna=देखना dekhti=देखती dekhta=देखता batata=बताता batati=बताती samjhaati=समझाती samjhata=समझाता chahiye=चाहिए hota=होता hona=होना hua=हुआ hui=हुई hue=हुए
us=उस is_=इस iss=इस inhe=इन्हें unhe=उन्हें yaha=यहाँ waha=वहाँ dono=दोनों sabse=सबसे pehla=पहला doosra=दूसरा teesra=तीसरा pehli=पहली agla=अगला agli=अगली
ya=या lekin=लेकिन kyunki=क्योंकि taki=ताकि isse=इससे usse=उससे jisse=जिससे""".split()
_MAP = {k: v for k, v in (w.split("=") for w in _W if "=" in w) if not k.endswith("_")}
_WORD = re.compile(r"[A-Za-z']+")
_LANGS = {"hinglish", "hindi", "mix3", "auto"}


def speechify(text: str) -> str:
    """Roman Hinglish -> mixed script for a Hindi TTS voice (Hindi words in Devanagari, English words unchanged)."""
    return _WORD.sub(lambda m: _MAP.get(m.group(0).lower(), m.group(0)), text)


def add_speech(script: dict, language: str) -> dict:
    """Give every beat a 'speech' field (what the voice says). An LLM-provided one is kept as is."""
    if script.get("mode") == "read":
        return script
    if language not in _LANGS:                 # e.g. English / Gujarati: the voice says exactly the caption, never a Hindi 'speech' line
        for b in script.get("beats", []):
            b["speech"] = b.get("say", "")
        if script.get("check"):
            script["check_speech"] = script["check"]
        return script
    for b in script["beats"]:
        if b.get("kind") == "definition":      # the book's exact words are spoken exactly, never transformed
            b["speech"] = b["say"]
        elif not b.get("speech"):
            b["speech"] = speechify(b["say"])
    if script.get("check") and not script.get("check_speech"):
        script["check_speech"] = speechify(script["check"])
    return script

