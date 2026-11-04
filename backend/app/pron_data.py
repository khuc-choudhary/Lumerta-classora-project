"""Curated pronunciations for terms that general-purpose voices often get wrong.
IPA uses '.' between syllables, 'ˈ' primary stress, 'ˌ' secondary stress.
STATUS: written by the LUMETRA CLASSORA developers from standard references; NOT reviewed by a lexicographer.
They are shown as 'curated', never as 'verified'. Users can override any entry (Pronunciation Studio -> My corrections)."""

# word -> IPA   (these are WORDS the voice should pronounce normally, not spell out)
CURATED = {
    "numpy": "ˈnʌm.paɪ", "scipy": "ˈsaɪ.paɪ", "pandas": "ˈpæn.dəz", "pytorch": "ˈpaɪ.ˌtɔːrtʃ", "tensorflow": "ˈtɛn.sər.ˌfloʊ",
    "keras": "ˈkɛ.rəs", "scikit": "ˈsaɪ.kɪt", "matplotlib": "ˈmæt.ˌplɒt.lɪb", "seaborn": "ˈsiː.bɔːrn", "kubernetes": "ˌkuː.bər.ˈnɛ.tiːz",
    "docker": "ˈdɒ.kər", "nginx": "ˈɛn.dʒɪn.ˌɛks", "json": "ˈdʒeɪ.sɒn", "regex": "ˈrɛ.dʒɛks", "oauth": "ˈoʊ.ˌɔːθ", "gui": "ˈɡuː.i",
    "linux": "ˈlɪ.nəks", "ubuntu": "ʊ.ˈbʊn.tuː", "unix": "ˈjuː.nɪks", "mysql": "ˌmaɪ.ˌɛs.kjuː.ˈɛl", "postgresql": "ˈpoʊst.ɡrɛs.ˌkjuː.ˈɛl",
    "sqlite": "ˈɛs.kjuː.ˌɛl.aɪt", "mongodb": "ˈmɒŋ.ɡoʊ.ˌdiː.ˈbiː", "java": "ˈdʒɑː.və", "javascript": "ˈdʒɑː.və.ˌskrɪpt",
    "python": "ˈpaɪ.θɒn", "typescript": "ˈtaɪp.ˌskrɪpt", "golang": "ˈɡoʊ.ˌlæŋ", "numeric": "njuː.ˈmɛ.rɪk",
    "bool": "buːl", "enum": "ˈiː.nʌm", "dequeue": "diː.ˈkjuː", "dataframe": "ˈdeɪ.tə.ˌfreɪm", "dataset": "ˈdeɪ.tə.ˌsɛt",
    "hyperparameter": "ˌhaɪ.pər.pə.ˈræ.mɪ.tər", "hyperparameters": "ˌhaɪ.pər.pə.ˈræ.mɪ.tərz", "backpropagation": "ˌbæk.ˌprɒ.pə.ˈɡeɪ.ʃən",
    "overfitting": "ˌoʊ.vər.ˈfɪ.tɪŋ", "underfitting": "ˌʌn.dər.ˈfɪ.tɪŋ", "tokenization": "ˌtoʊ.kə.naɪ.ˈzeɪ.ʃən", "tokenizer": "ˈtoʊ.kə.ˌnaɪ.zər",
    "softmax": "ˈsɒft.ˌmæks", "relu": "ˈrɛ.luː", "sigmoid": "ˈsɪɡ.mɔɪd", "perceptron": "pər.ˈsɛp.trɒn", "autoencoder": "ˌɔː.toʊ.ɪn.ˈkoʊ.dər",
    "transformer": "træns.ˈfɔːr.mər", "embedding": "ɪm.ˈbɛ.dɪŋ", "embeddings": "ɪm.ˈbɛ.dɪŋz", "normalization": "ˌnɔːr.mə.laɪ.ˈzeɪ.ʃən",
    "denormalization": "diː.ˌnɔːr.mə.laɪ.ˈzeɪ.ʃən", "metadata": "ˈmɛ.tə.ˌdeɪ.tə", "schema": "ˈski.mə", "ipv4": "ˌaɪ.ˌpiː.ˌviː.ˈfɔːr",
    "ipv6": "ˌaɪ.ˌpiː.ˌviː.ˈsɪks", "localhost": "ˈloʊ.kəl.ˌhoʊst", "backend": "ˈbæk.ˌɛnd", "frontend": "ˈfrʌnt.ˌɛnd", "api": "ˌeɪ.piː.ˈaɪ",
    "ram": "ræm", "rom": "rɒm", "cache": "kæʃ", "bit": "bɪt", "byte": "baɪt", "boolean": "ˈbuː.li.ən", "iteration": "ˌɪ.tə.ˈreɪ.ʃən",
    "algorithm": "ˈæl.ɡə.ˌrɪ.ðəm", "algorithms": "ˈæl.ɡə.ˌrɪ.ðəmz", "mathematics": "ˌmæ.θə.ˈmæ.tɪks", "eigenvalue": "ˈaɪ.ɡən.ˌvæl.juː",
    "eigenvector": "ˈaɪ.ɡən.ˌvɛk.tər", "theorem": "ˈθɪə.rəm", "polynomial": "ˌpɒ.lɪ.ˈnoʊ.mi.əl", "logarithm": "ˈlɒ.ɡə.ˌrɪ.ðəm",
    # words missing from the open CMU dictionary (found by tests/audit) + compounds whose automatic composition is unreliable
    "recursion": "rɪ.ˈkɜːr.ʒən", "iterator": "ˈɪ.tə.ˌreɪ.tər", "iterable": "ˈɪ.tə.rə.bəl", "tuple": "ˈtʌ.pəl", "encapsulation": "ɪn.ˌkæp.sjʊ.ˈleɪ.ʃən",
    "cryptography": "krɪp.ˈtɒ.ɡrə.fi", "decryption": "diː.ˈkrɪp.ʃən", "lemmatization": "ˌlɛ.mə.taɪ.ˈzeɪ.ʃən", "refactoring": "riː.ˈfæk.tə.rɪŋ",
    "regularization": "ˌrɛ.ɡjʊ.lə.raɪ.ˈzeɪ.ʃən", "trigonometry": "ˌtrɪ.ɡə.ˈnɒ.mə.tri", "virtualization": "ˌvɜːr.tʃu.ə.laɪ.ˈzeɪ.ʃən",
    "concurrency": "kən.ˈkɜːr.ən.si", "factorial": "fæk.ˈtɔː.ri.əl", "cybersecurity": "ˌsaɪ.bər.sɪ.ˈkjʊ.rə.ti", "microservice": "ˈmaɪ.kroʊ.ˌsɜːr.vɪs",
    "serverless": "ˈsɜːr.vər.ləs",
    # brand / product names (pronunciation chosen by the product, so they are never spelled out)
    "aira": "ˈaɪ.rə", "nex": "nɛks", "lumetra": "luː.ˈmɛ.trə", "classora": "klæ.ˈsɔː.rə",
}
CURATED_SOURCE = {"aira": "brand", "nex": "brand", "lumetra": "brand", "classora": "brand"}

# Acronyms that ARE spoken letter by letter (the only place letter-spelling is allowed).
ACRONYMS = {
    "sql", "cpu", "gpu", "tpu", "html", "css", "http", "https", "url", "uri", "dns", "tcp", "udp", "ip", "pdf", "xml", "yaml", "ai", "ml", "dl", "nlp",
    "cnn", "rnn", "lstm", "gan", "svm", "knn", "pca", "ide", "os", "ssd", "hdd", "usb", "lan", "wan", "vpn", "ssh", "ftp", "smtp", "dbms", "rdbms",
    "cli", "sdk", "orm", "crud", "rest", "ui", "ux", "csv", "gpt", "llm", "rag", "mse", "rmse", "mae", "roc", "auc", "iot", "ar", "vr", "tf", "idf",
}
# Roman letter names for ElevenLabs-style plain text spelling
LETTER_NAMES = {c: c.upper() for c in "abcdefghijklmnopqrstuvwxyz"}
